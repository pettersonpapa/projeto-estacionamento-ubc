// ParkingHub - lógica do sistema de reservas (versão simples).
// Ordem do arquivo: constantes -> dados -> planta -> regras -> etapas 1, 2 e 3 -> reservas -> saída -> tema.

/* ---------- Constantes e dados ---------- */

// Valores de exemplo: altere só estes números para mudar as tarifas (em reais).
const TARIFAS = { hora: 8, diaria: 35, horaExtra: 5 };

// 1 hora em milissegundos (60 x 60 x 1000). O JavaScript trabalha com datas em milissegundos.
const MS_POR_HORA = 36e5;

// Nome da "gaveta" onde as reservas ficam guardadas no navegador (localStorage).
const CHAVE_ARMAZENAMENTO = "parkinghub.simples.v2";

// Formas de pagamento. A chave é igual ao "value" do botão de rádio no HTML.
// pagaNoLocal = true  -> a reserva fica com pagamento pendente (paga no estacionamento).
// pagaNoLocal = false -> o pagamento é apenas simulado (Wallet e Pix).
const PAGAMENTOS = {
  cartao: { nome: "Cartão de crédito", pagaNoLocal: true, descricao: "Você paga com cartão de crédito ao chegar ao estacionamento." },
  "google-wallet": { nome: "Google Wallet", pagaNoLocal: false, descricao: "Simulação da confirmação pela carteira digital." },
  pix: { nome: "Pix", pagaNoLocal: false, descricao: "Veja o QR Code de demonstração e confirme para simular o pagamento." },
  dinheiro: { nome: "Dinheiro", pagaNoLocal: true, descricao: "Você paga em dinheiro ao chegar ao estacionamento." }
};

// Atalho: $("nome") devolve o elemento da página que tem id="nome".
const $ = id => document.getElementById(id);

// Formata um número como dinheiro brasileiro: 16 -> "R$ 16,00".
const moeda = valor => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Formata milissegundos como data e hora: "26/10/2026, 08:00".
const dataHora = milissegundos => new Date(milissegundos).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Protege contra XSS: troca & < > " por códigos HTML, para o texto digitado nunca virar código.
const escaparHtml = texto => texto.replace(/[&<>"]/g, caractere => "&#" + caractere.charCodeAt() + ";");

// Devolve a modalidade marcada no formulário: "horario" ou "diaria".
const modalidade = () => document.querySelector('[name="modalidade"]:checked').value;

// Converte milissegundos para o texto "AAAA-MM-DDTHH:MM" no horário local do usuário.
// (toISOString trabalha em UTC, por isso o fuso horário é descontado antes.)
const paraTextoLocal = milissegundos => new Date(milissegundos - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// Lista com todas as reservas. Começa com o que estava salvo no navegador (ou vazia).
let reservas = [];
try { reservas = JSON.parse(localStorage.getItem(CHAVE_ARMAZENAMENTO) || "[]"); } catch {}

// Grava a lista de reservas no navegador. JSON.stringify transforma a lista em texto.
// O try/catch evita erro em navegadores que bloqueiam o armazenamento.
const salvar = () => { try { localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(reservas)); } catch {} };

let vagaSelecionada = null; // vaga clicada na planta (ou null quando nenhuma está escolhida)
let dadosCliente = null;    // nome, telefone e placa já validados (passam da etapa 2 para a 3)
let reservaEmSaida = null;  // reserva aberta na janela de simulação de saída

/* ---------- Planta: 26 vagas de carro (V), 6 de moto (M) e 2 acessíveis (D) ---------- */

// Lista de todas as vagas criadas. Cada item é { codigo, tipo, botao }.
const vagas = [];

// Cria o botão de uma vaga e o coloca dentro de uma fileira da planta.
function criarVaga(codigo, tipo, fileira, classeExtra = "") {
  const botao = document.createElement("button");
  botao.type = "button"; // não envia o formulário ao clicar
  botao.className = "vaga " + classeExtra;
  botao.textContent = codigo + (tipo == "Moto" ? " 🏍️" : tipo == "Acessível" ? " ♿" : "");
  const vaga = { codigo, tipo, botao };

  // Ao clicar: se a vaga já estava selecionada, desmarca; senão, seleciona. Depois redesenha a tela.
  botao.onclick = () => {
    vagaSelecionada = vagaSelecionada == vaga ? null : vaga;
    $("aviso").hidden = true;
    atualizar();
  };

  vagas.push(vaga);
  fileira.append(botao);
}

// Cria uma pilha com 3 vagas de moto (M) em sequência, começando em "primeira".
function motos(fileira, primeira) {
  const pilha = document.createElement("div");
  pilha.className = "motos";
  fileira.append(pilha);
  for (let numero = primeira; numero < primeira + 3; numero++) criarVaga("M" + numero, "Moto", pilha, "moto");
}

// Cria vagas de carro (V) do número "de" até o número "ate".
function carros(fileira, de, ate) {
  for (let numero = de; numero <= ate; numero++) criarVaga("V" + numero, "Carro", fileira);
}

// Monta a planta na mesma ordem do desenho do estacionamento.
motos($("fileira-topo"), 1);                    // fileira de cima: M1 a M3
carros($("fileira-topo"), 1, 6);                //                  V1 a V6
criarVaga("D1", "Acessível", $("fileira-meio"), "acessivel"); // fileira do meio: D1, V7 a V13, D2, V14 a V20
carros($("fileira-meio"), 7, 13);
criarVaga("D2", "Acessível", $("fileira-meio"), "acessivel");
carros($("fileira-meio"), 14, 20);
motos($("fileira-base"), 4);                    // fileira de baixo: M4 a M6
carros($("fileira-base"), 21, 26);              //                   V21 a V26

/* ---------- Período e regras de ocupação ---------- */

// Lê data e horários do formulário e calcula o período e o valor.
// Devolve { inicio, fim, valor } (em milissegundos e reais) ou { erro } com a mensagem do problema.
function periodo() {
  const dia = $("data").value; // texto como "2026-10-26"
  // `${dia}T${hora}` forma "2026-10-26T08:00"; o "+" na frente transforma a data em número (milissegundos).
  const inicio = +new Date(`${dia}T${$("entrada").value}`);
  if (!(inicio > 0)) return { erro: "Escolha uma data e um horário de entrada válidos." }; // data inválida vira NaN

  // Diária: o fim é o início + 24 horas e o valor é fixo.
  if (modalidade() == "diaria") return { inicio, fim: inicio + 24 * MS_POR_HORA, valor: TARIFAS.diaria };

  // Por horário: a saída precisa ser depois da entrada, no mesmo dia.
  const fim = +new Date(`${dia}T${$("saida").value}`);
  if (!(fim > inicio)) return { erro: "A saída precisa ser depois da entrada, no mesmo dia. Para 24 horas, escolha a diária." };

  // Math.ceil arredonda as horas para cima: 2h30 cobra 3 horas.
  return { inicio, fim, valor: Math.ceil((fim - inicio) / MS_POR_HORA) * TARIFAS.hora };
}

// Dois períodos se sobrepõem quando cada um começa antes de o outro terminar.
// Esta função diz se já existe reserva ATIVA no mesmo período para a mesma vaga ou a mesma placa.
//   campo = "vaga" ou "placa"  |  valor = qual vaga ou qual placa verificar
function conflito(periodoAtual, campo, valor) {
  if (periodoAtual.erro) return false; // período inválido: não há o que comparar
  return reservas.some(reserva =>
    reserva.status == "ativa" &&
    reserva[campo] == valor &&
    periodoAtual.inicio < reserva.fim &&
    periodoAtual.fim > reserva.inicio
  );
}

/* ---------- Etapa 1: atualizar planta e resumo ---------- */

// Redesenha a etapa 1. É chamada toda vez que algo muda (período, vaga, reservas).
function atualizar() {
  const periodoAtual = periodo();
  const ehDiaria = modalidade() == "diaria";

  $("campo-saida").hidden = ehDiaria; // na diária não existe horário de saída
  $("erro-periodo").textContent = periodoAtual.erro || "";
  $("erro-periodo").hidden = !periodoAtual.erro;

  // Se o novo período deixou a vaga escolhida ocupada, avisa e desfaz a escolha.
  if (vagaSelecionada && conflito(periodoAtual, "vaga", vagaSelecionada.codigo)) {
    $("aviso").textContent = `A vaga ${vagaSelecionada.codigo} está reservada no novo período. Escolha outra vaga.`;
    $("aviso").hidden = false;
    vagaSelecionada = null;
  }

  // Percorre as 34 vagas: bloqueia as ocupadas, destaca a escolhida e conta as livres.
  let livres = 0;
  for (const vaga of vagas) {
    const ocupada = conflito(periodoAtual, "vaga", vaga.codigo);
    vaga.botao.disabled = Boolean(periodoAtual.erro) || ocupada;
    vaga.botao.classList.toggle("selecionada", vaga == vagaSelecionada); // liga a classe só na escolhida
    if (!periodoAtual.erro && !ocupada) livres++;
  }
  $("disponiveis").textContent = periodoAtual.erro ? "Defina o período" : `${livres} de ${vagas.length} disponíveis`;

  // Resumo da reserva ("—" quando o período é inválido).
  $("r-vaga").textContent = vagaSelecionada ? vagaSelecionada.codigo : "Escolha na planta";
  $("r-tipo").textContent = vagaSelecionada ? vagaSelecionada.tipo : "Carro, moto ou vaga acessível";
  $("r-entrada").textContent = periodoAtual.erro ? "—" : dataHora(periodoAtual.inicio);
  $("r-saida").textContent = periodoAtual.erro ? "—" : dataHora(periodoAtual.fim);
  $("r-total").textContent = periodoAtual.erro ? "—" : moeda(periodoAtual.valor);

  // Duração: minutos totais -> horas inteiras (Math.floor) e minutos que sobram (% = resto da divisão).
  const minutos = Math.round((periodoAtual.fim - periodoAtual.inicio) / 60000);
  $("r-duracao").textContent = periodoAtual.erro ? "—" : ehDiaria ? "24 horas" : `${Math.floor(minutos / 60)} h${minutos % 60 ? ` ${minutos % 60} min` : ""}`;

  // Botão Continuar: só liberado com período válido e vaga escolhida.
  $("continuar").disabled = Boolean(periodoAtual.erro) || !vagaSelecionada;
  $("continuar").textContent = periodoAtual.erro
    ? "Revise a data e os horários"
    : vagaSelecionada ? `Continuar com a vaga ${vagaSelecionada.codigo}` : "Selecione uma vaga";
}

/* ---------- Navegação entre as 3 etapas ---------- */

let etapa = 0; // etapa atual: 0 = vaga e período, 1 = seus dados, 2 = pagamento

// Mostra a etapa "numero" e esconde as outras (o atributo "hidden" esconde o elemento).
function mostrar(numero) {
  etapa = numero;
  $("tela-vaga").hidden = numero != 0;
  $("tela-confirmar").hidden = numero == 0;
  $("form-dados").hidden = numero != 1;
  $("form-pagamento").hidden = numero != 2;
  $("minhas").hidden = numero != 0;
  $("c-cliente").hidden = numero != 2;
  // Barra de progresso: "atual" na etapa em andamento, "feito" nas anteriores, sem classe nas próximas.
  [...$("etapas").children].forEach((item, posicao) => {
    item.className = posicao == numero ? "atual" : posicao < numero ? "feito" : "";
  });
  window.scrollTo(0, 0); // volta ao topo da página
}

// Preenche o resumo lateral das etapas 2 e 3 com a vaga e o período escolhidos.
function preencherResumo() {
  const periodoAtual = periodo();
  $("c-vaga").textContent = vagaSelecionada.codigo;
  $("c-tipo").textContent = vagaSelecionada.tipo;
  $("c-mod").textContent = modalidade() == "diaria" ? "Diária de 24 h" : "Por horário";
  $("c-entrada").textContent = dataHora(periodoAtual.inicio);
  $("c-saida").textContent = dataHora(periodoAtual.fim);
  $("c-total").textContent = moeda(periodoAtual.valor);
}

// Botão "Continuar" da etapa 1: confere tudo e vai para a etapa 2.
$("tela-vaga").onsubmit = evento => {
  evento.preventDefault(); // impede o comportamento padrão do formulário (recarregar a página)
  const periodoAtual = periodo();
  if (periodoAtual.erro || !vagaSelecionada || conflito(periodoAtual, "vaga", vagaSelecionada.codigo)) return atualizar();

  const acessivel = vagaSelecionada.tipo == "Acessível";
  $("ajuda-tipo").textContent = acessivel
    ? `Você escolheu a vaga ${vagaSelecionada.codigo}, acessível para carro. Anexe a credencial abaixo.`
    : `Você escolheu a vaga ${vagaSelecionada.codigo}, destinada a ${vagaSelecionada.tipo == "Moto" ? "motos" : "carros"}.`;
  $("campo-cred").hidden = !acessivel; // só vaga acessível pede credencial
  preencherResumo();
  mostrar(1);
};

$("voltar").onclick = () => mostrar(etapa - 1);

// Qualquer mudança nos campos da etapa 1 (data, hora, modalidade) redesenha a tela.
$("tela-vaga").oninput = () => { $("aviso").hidden = true; atualizar(); };

/* ---------- Etapa 2: dados do cliente ---------- */

// Placa em maiúsculas e sem espaços ou hífens: "abc-1d23" -> "ABC1D23".
// /[\s-]/g é uma expressão regular: espaço ou hífen, em todas as ocorrências (g).
const normalizarPlaca = texto => texto.toUpperCase().replace(/[\s-]/g, "");

// Telefone só com dígitos, sem o código do país: "+55 (11) 99999-8888" -> "11999998888".
function normalizarTelefone(texto) {
  const digitos = texto.replace(/\D/g, ""); // \D = qualquer caractere que não seja dígito
  return /^55\d{10,11}$/.test(digitos) ? digitos.slice(2) : digitos; // se começa com 55 + 10 ou 11 dígitos, remove o 55
}

// Formata como "(11) 99999-8888" (10 ou 11 dígitos). Outros textos ficam como estão.
const formatarTelefone = telefone =>
  /^\d{10,11}$/.test(telefone) ? `(${telefone.slice(0, 2)}) ${telefone.slice(2, -4)}-${telefone.slice(-4)}` : telefone;

// Enquanto digita no telefone, apaga letras e símbolos não permitidos.
$("telefone").oninput = () => { $("telefone").value = $("telefone").value.replace(/[^\d+()\s-]/g, ""); };
// Ao sair do campo, formata o número. Na placa, converte para maiúsculas.
$("telefone").onblur = () => { $("telefone").value = formatarTelefone(normalizarTelefone($("telefone").value)); };
$("placa").onblur = () => { $("placa").value = normalizarPlaca($("placa").value); };

// Mostra a mensagem de erro da etapa 2 e põe o cursor no campo com problema.
function erroDados(mensagem, campo) {
  $("erro-dados").textContent = mensagem;
  $("erro-dados").hidden = false;
  campo.focus();
}

// Botão "Ir para pagamento": valida cada campo. Cada "return erroDados(...)" mostra o erro e interrompe.
$("form-dados").onsubmit = evento => {
  evento.preventDefault();
  $("erro-dados").hidden = true;
  const periodoAtual = periodo();
  const nome = $("nome").value.trim().replace(/\s+/g, " "); // remove espaços sobrando
  const telefone = normalizarTelefone($("telefone").value);
  const placa = normalizarPlaca($("placa").value);

  // Nome: pelo menos 2 palavras; só letras (\p{L} inclui acentos), espaço, ponto, apóstrofo e hífen.
  if (nome.split(" ").length < 2 || !/^[\p{L} .'’-]+$/u.test(nome))
    return erroDados("Informe seu nome completo, com nome e sobrenome.", $("nome"));

  // Telefone: DDD (2 dígitos) + fixo (começa em 2 a 9 e tem mais 7 dígitos) OU celular (9 e mais 8 dígitos).
  if (!/^[1-9]{2}(?:[2-9]\d{7}|9\d{8})$/.test(telefone))
    return erroDados("Informe um telefone com DDD: 10 dígitos para fixo ou 11 para celular.", $("telefone"));

  // Placa: 3 letras + 1 número + 1 letra ou número + 2 números (aceita o padrão antigo e o Mercosul).
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa))
    return erroDados("Informe uma placa válida, como ABC-1234 ou ABC1D23.", $("placa"));

  // A mesma placa não pode ter duas reservas ativas no mesmo período.
  if (conflito(periodoAtual, "placa", placa))
    return erroDados(`A placa ${placa} já tem uma reserva ativa neste período. Use outro horário.`, $("placa"));

  // Vaga acessível: exige credencial em JPG, PNG, WebP ou PDF, com conteúdo e até 5 MB.
  const acessivel = vagaSelecionada.tipo == "Acessível";
  if (acessivel) {
    const arquivo = $("credencial").files[0];
    const tiposPermitidos = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!arquivo || !tiposPermitidos.includes(arquivo.type) || !arquivo.size || arquivo.size > 5 * 1024 * 1024)
      return erroDados("Anexe a credencial em JPG, PNG, WebP ou PDF, com até 5 MB.", $("credencial"));
  }

  // Tudo certo: guarda os dados (o arquivo em si NÃO é guardado, só a indicação de que foi anexado).
  dadosCliente = { nome, telefone, placa, credencialAnexada: acessivel };
  $("nome").value = nome;
  $("telefone").value = formatarTelefone(telefone);
  $("placa").value = placa;
  $("c-nome").textContent = `${nome} · ${placa}`;
  mostrar(2);
};

/* ---------- Etapa 3: pagamento ---------- */

// Devolve a forma de pagamento marcada (ex.: "pix") ou undefined se nenhuma estiver marcada.
// O "?." evita erro quando não há nada marcado.
const formaDePagamento = () => document.querySelector('[name="pagamento"]:checked')?.value;

// Ao escolher uma forma de pagamento: mostra a descrição, o QR Code (só no Pix) e ajusta o botão.
$("form-pagamento").onchange = () => {
  const forma = PAGAMENTOS[formaDePagamento()];
  $("pg-titulo").textContent = forma.nome;
  $("pg-texto").textContent = forma.descricao;
  $("pix").hidden = formaDePagamento() != "pix";
  $("c-rotulo").textContent = forma.pagaNoLocal ? "Total a pagar no local" : "Total da reserva";
  $("pagar").textContent = forma.pagaNoLocal ? "Reservar e pagar no local" : "Simular pagamento e reservar";
  $("pagar").disabled = false;
};

// Botão final: confere a vaga de novo, CRIA a reserva, salva e volta para a etapa 1.
$("form-pagamento").onsubmit = evento => {
  evento.preventDefault();
  const periodoAtual = periodo();
  if (!formaDePagamento()) return;

  // Confere de novo: outra aba do navegador poderia ter reservado a vaga enquanto o formulário estava aberto.
  if (periodoAtual.erro || conflito(periodoAtual, "vaga", vagaSelecionada.codigo)) {
    mostrar(0);
    return atualizar();
  }

  const reserva = {
    id: Date.now(), // horário atual em milissegundos: serve como identificador único
    vaga: vagaSelecionada.codigo,
    tipo: vagaSelecionada.tipo,
    nome: dadosCliente.nome,
    telefone: dadosCliente.telefone,
    placa: dadosCliente.placa,
    credencialAnexada: dadosCliente.credencialAnexada,
    pagamento: formaDePagamento(),
    pagamentoSimulado: !PAGAMENTOS[formaDePagamento()].pagaNoLocal, // true = Pix/Wallet; false = pendente (cartão/dinheiro)
    modalidade: modalidade(),
    inicio: periodoAtual.inicio,
    fim: periodoAtual.fim,
    valor: periodoAtual.valor,
    adicional: 0,    // taxa de atraso, calculada só na saída
    status: "ativa"  // pode virar "cancelada" ou "encerrada"
  };
  reservas.push(reserva); // acrescenta ao final da lista
  salvar();

  // Mensagem de sucesso, limpeza dos formulários e volta para a etapa 1.
  $("aviso").textContent = `Reserva da vaga ${reserva.vaga} confirmada para ${reserva.nome}, placa ${reserva.placa}. Total: ${moeda(reserva.valor)}.`;
  $("aviso").hidden = false;
  vagaSelecionada = null;
  $("form-dados").reset();
  $("form-pagamento").reset();
  $("pix").hidden = true;
  $("pagar").disabled = true;
  $("pg-titulo").textContent = "Escolha uma opção acima";
  mostrar(0);
  atualizar();
  renderizar();
  $("minhas").scrollIntoView();
};

/* ---------- Minhas reservas ---------- */

// Desenha a lista de reservas (a mais nova primeiro).
function renderizar() {
  $("contador").textContent = reservas.filter(reserva => reserva.status == "ativa").length; // conta só as ativas
  $("limpar").disabled = !reservas.length;

  // [...reservas].reverse() copia a lista e inverte a ordem, sem alterar a original.
  // .map transforma cada reserva em um texto HTML; .join("") junta todos os textos em um só.
  $("lista").innerHTML = [...reservas].reverse().map(reserva => {
    const pagamento = PAGAMENTOS[reserva.pagamento].nome +
      (reserva.status == "cancelada" ? "" : reserva.pagamentoSimulado ? " (simulado)" : " (pendente, paga no local)");

    // Reserva ativa mostra os botões; as demais mostram o status. Os botões guardam o id da reserva
    // em atributos data-... para sabermos qual deles foi clicado.
    const lado = reserva.status == "ativa"
      ? `<span class="acoes"><button class="botao" data-saida="${reserva.id}">Simular saída</button><button class="botao" data-cancelar="${reserva.id}">Cancelar reserva</button></span>`
      : `<span><strong>${reserva.status == "cancelada" ? "Cancelada" : "Encerrada"}</strong>` +
        (reserva.status == "encerrada" ? `<small>Saída: ${dataHora(reserva.saidaReal)}. Adicional: ${moeda(reserva.adicional)}. Total: ${moeda(reserva.valor + reserva.adicional)}</small>` : "") + `</span>`;

    // O nome digitado passa por escaparHtml() por segurança.
    return `<article class="recibo">
      <div><strong class="codigo">${reserva.vaga}</strong><div>
        <p>${escaparHtml(reserva.nome)} · ${formatarTelefone(reserva.telefone)}</p>
        <p>${dataHora(reserva.inicio)} → ${dataHora(reserva.fim)}</p>
        <small>${reserva.tipo} · ${reserva.placa} · ${reserva.modalidade == "diaria" ? "Diária de 24 h" : "Por horário"} · ${moeda(reserva.valor)} · ${pagamento}${reserva.credencialAnexada ? " · Credencial anexada" : ""}</small>
      </div></div>${lado}</article>`;
  }).join("") || "<p class='nota'>Nenhuma reserva por enquanto. Selecione uma vaga para começar.</p>";
}

// Um único "ouvinte" de clique para a lista inteira (delegação de eventos):
// descobre qual botão foi clicado olhando os atributos data-cancelar e data-saida.
$("lista").onclick = evento => {
  const botao = evento.target.closest("button");
  if (!botao) return;

  if (botao.dataset.cancelar) {
    // Cancelar: pede confirmação, muda o status e a vaga volta a ficar livre.
    const reserva = reservas.find(item => item.id == botao.dataset.cancelar);
    if (!confirm(`Cancelar a reserva da vaga ${reserva.vaga}? Ela ficará disponível novamente.`)) return;
    reserva.status = "cancelada";
    salvar();
    atualizar();
    renderizar();
  } else if (botao.dataset.saida) {
    // Simular saída: abre a janela já preenchida com o fim contratado.
    reservaEmSaida = reservas.find(item => item.id == botao.dataset.saida);
    $("titulo-saida").textContent = `Simular saída da vaga ${reservaEmSaida.vaga}`;
    $("texto-saida").textContent = `Período contratado até ${dataHora(reservaEmSaida.fim)}. Altere a saída para testar a taxa extra.`;
    $("saida-real").value = paraTextoLocal(reservaEmSaida.fim);
    calcularSaida();
    $("modal-saida").showModal();
  }
};

// Botão "Limpar reservas": apaga todas, depois de confirmar.
$("limpar").onclick = () => {
  if (!confirm("Apagar todas as reservas salvas neste navegador? Não é possível desfazer.")) return;
  reservas = [];
  salvar();
  atualizar();
  renderizar();
};

/* ---------- Saída: cada hora de atraso (iniciada) custa a taxa extra ---------- */

// Calcula a taxa de atraso para o horário de saída digitado na janela.
// Devolve { saidaReal, adicional } ou null se o horário for inválido.
function calcularSaida() {
  const saidaReal = +new Date($("saida-real").value);
  const invalida = !(saidaReal >= reservaEmSaida.inicio); // saída antes da entrada (ou data inválida)
  $("erro-saida").textContent = invalida ? "Informe uma saída igual ou posterior à entrada da reserva." : "";
  $("erro-saida").hidden = !invalida;
  $("resultado-saida").innerHTML = "";
  if (invalida) return null;

  // Minutos depois do fim contratado. Math.max(0, ...) impede valor negativo se sair antes do fim.
  const minutosExcedidos = Math.max(0, Math.ceil((saidaReal - reservaEmSaida.fim) / 60000));
  // Horas iniciadas x taxa extra. Exemplo: 80 min -> 2 horas -> R$ 10.
  const adicional = Math.ceil(minutosExcedidos / 60) * TARIFAS.horaExtra;

  // Cada par [nome, valor] vira uma linha do resultado. ([nome, valor]) => ... separa o par em duas variáveis.
  $("resultado-saida").innerHTML = [
    ["Reserva", moeda(reservaEmSaida.valor)],
    ["Tempo excedido", minutosExcedidos ? `${Math.floor(minutosExcedidos / 60)} h ${minutosExcedidos % 60} min` : "Sem excedente"],
    ["Taxa adicional", moeda(adicional)],
    ["Total", moeda(reservaEmSaida.valor + adicional)]
  ].map(([nome, valor]) => `<p><span>${nome}</span><b>${valor}</b></p>`).join("");

  return { saidaReal, adicional };
}

// A cada mudança na data, recalcula o resultado na hora.
$("saida-real").oninput = calcularSaida;
$("fechar-saida").onclick = () => $("modal-saida").close();

// Botão "Encerrar reserva". O formulário tem method="dialog", então a janela fecha sozinha ao enviar.
$("form-saida").onsubmit = evento => {
  const calculo = calcularSaida();
  if (!calculo) return evento.preventDefault(); // saída inválida: mantém a janela aberta
  // Object.assign altera o próprio objeto da reserva, que já está dentro da lista "reservas".
  Object.assign(reservaEmSaida, { status: "encerrada", saidaReal: calculo.saidaReal, adicional: calculo.adicional });
  salvar();
  atualizar();
  renderizar();
};

/* ---------- Tema claro/escuro e início do programa ---------- */

// Liga ou desliga o tema escuro: escreve data-tema no elemento raiz (o CSS troca as cores por isso) e troca o ícone.
function aplicarTema(escuro) {
  document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
  $("tema").textContent = escuro ? "☀️" : "🌙";
}
$("tema").onclick = () => aplicarTema(document.documentElement.dataset.tema != "escuro");
// Começa no mesmo tema que o sistema operacional do usuário usa.
aplicarTema(matchMedia("(prefers-color-scheme: dark)").matches);

// Início: data de hoje já preenchida (assim o período é válido e a planta não aparece bloqueada).
$("data").value = paraTextoLocal(Date.now()).slice(0, 10);
$("tarifas").textContent = `${moeda(TARIFAS.horaExtra)} por hora excedente iniciada. Valores de exemplo: ${moeda(TARIFAS.hora)} por hora ou ${moeda(TARIFAS.diaria)} pela diária.`;
mostrar(0);     // começa na etapa 1
atualizar();    // desenha a planta e o resumo
renderizar();   // mostra as reservas que já estavam salvas
