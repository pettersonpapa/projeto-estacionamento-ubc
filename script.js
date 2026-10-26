// ParkingHub - reserva de vagas de estacionamento (versão simples)

// ----- 1) Variáveis -----
const VALOR_HORA = 8;        // tarifas de exemplo, em reais
const VALOR_DIARIA = 35;
const MS_POR_HORA = 3600000; // o JavaScript guarda datas em milissegundos: 1 hora = 3.600.000 ms

let vagas = [];            // as 34 vagas: cada uma é { codigo, tipo, botao }
let reservas = [];         // todas as reservas feitas
let vagaEscolhida = null;  // vaga clicada na planta (null = nenhuma)
let etapaAtual = 1;        // 1 = vaga e período, 2 = seus dados, 3 = pagamento

// Carrega as reservas salvas no navegador. O localStorage guarda só texto, então usamos JSON.parse.
if (localStorage.getItem("reservas-parkinghub") != null) {
  reservas = JSON.parse(localStorage.getItem("reservas-parkinghub"));
}
function salvarReservas() {
  localStorage.setItem("reservas-parkinghub", JSON.stringify(reservas)); // lista -> texto
}

function pegar(id) { return document.getElementById(id); } // atalho: pegar("nome") acha o elemento com id="nome"
function moeda(valor) { return "R$ " + valor.toFixed(2).replace(".", ","); }  // 16 -> "R$ 16,00"
function dataHora(ms) { return new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
function ehDiaria() { return document.querySelector('input[name="modalidade"]:checked').value == "diaria"; }
function icone(nome) { return '<svg class="icone-svg"><use href="#icone-' + nome + '"/></svg>'; } // desenhos do index.html

// ----- 2) Planta: 26 vagas de carro (V), 6 de moto (M) e 2 acessíveis (D) -----
function criarVaga(codigo, tipo, fileira, classe) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "vaga " + classe;
  botao.innerHTML = codigo;
  if (tipo == "Moto") botao.innerHTML += icone("moto");
  if (tipo == "Acessível") botao.innerHTML += icone("acessivel");

  const vaga = { codigo: codigo, tipo: tipo, botao: botao };
  botao.onclick = function () {  // ao clicar: escolhe a vaga (ou desmarca, se já era a escolhida)
    vagaEscolhida = (vagaEscolhida == vaga) ? null : vaga;
    atualizar();
  };
  vagas.push(vaga);
  fileira.append(botao);
}

function criarMotos(fileira, primeira) {  // pilha de 3 vagas de moto
  const pilha = document.createElement("div");
  pilha.className = "motos";
  fileira.append(pilha);
  for (let n = primeira; n < primeira + 3; n++) criarVaga("M" + n, "Moto", pilha, "moto");
}
function criarCarros(fileira, de, ate) {
  for (let n = de; n <= ate; n++) criarVaga("V" + n, "Carro", fileira, "");
}

criarMotos(pegar("fileira-topo"), 1);       // fileira de cima: M1 a M3 e V1 a V6
criarCarros(pegar("fileira-topo"), 1, 6);
criarVaga("D1", "Acessível", pegar("fileira-meio"), "acessivel");  // fileira do meio: D1, V7 a V13, D2, V14 a V20
criarCarros(pegar("fileira-meio"), 7, 13);
criarVaga("D2", "Acessível", pegar("fileira-meio"), "acessivel");
criarCarros(pegar("fileira-meio"), 14, 20);
criarMotos(pegar("fileira-base"), 4);       // fileira de baixo: M4 a M6 e V21 a V26
criarCarros(pegar("fileira-base"), 21, 26);

// ----- 3) Período, valor e conflitos -----

// Lê a data e os horários e devolve { inicio, fim, valor }. Devolve null se estiver inválido.
function calcularPeriodo() {
  const dia = pegar("data").value;
  const inicio = new Date(dia + "T" + pegar("entrada").value).getTime();
  const fim = ehDiaria() ? inicio + 24 * MS_POR_HORA : new Date(dia + "T" + pegar("saida").value).getTime();
  if (isNaN(inicio) || isNaN(fim) || fim <= inicio) return null;  // isNaN = "não é número" (data vazia)

  let valor = VALOR_DIARIA;
  if (!ehDiaria()) valor = Math.ceil((fim - inicio) / MS_POR_HORA) * VALOR_HORA;  // ceil arredonda p/ cima: 2h30 = 3 horas
  return { inicio: inicio, fim: fim, valor: valor };
}

// Já existe reserva ativa com essa vaga (campo = "vaga") ou placa (campo = "placa") nesse período?
// Dois períodos se sobrepõem quando cada um começa antes de o outro terminar.
function temConflito(campo, valor, periodo) {
  for (const reserva of reservas) {
    if (reserva.status == "ativa" && reserva[campo] == valor) {
      if (periodo.inicio < reserva.fim && periodo.fim > reserva.inicio) return true;
    }
  }
  return false;
}

// ----- 4) Etapa 1: vaga e período -----

// Redesenha a etapa 1. Roda toda vez que algo muda (data, horário, vaga clicada).
function atualizar() {
  const periodo = calcularPeriodo();
  pegar("campo-saida").hidden = ehDiaria();        // na diária não há horário de saída
  pegar("erro-periodo").hidden = periodo != null;  // aviso só se o período for inválido

  // Se a vaga escolhida ficou ocupada no novo período, desmarca.
  if (vagaEscolhida != null && periodo != null && temConflito("vaga", vagaEscolhida.codigo, periodo)) {
    vagaEscolhida = null;
    pegar("aviso").textContent = "A vaga escolhida está ocupada nesse período. Escolha outra.";
    pegar("aviso").hidden = false;
  }

  // Passa por todas as vagas: bloqueia as ocupadas, destaca a escolhida e conta as livres.
  let livres = 0;
  for (const vaga of vagas) {
    const ocupada = periodo != null && temConflito("vaga", vaga.codigo, periodo);
    vaga.botao.disabled = periodo == null || ocupada;
    if (vaga == vagaEscolhida) {
      vaga.botao.classList.add("selecionada");     // pinta de laranja
    } else {
      vaga.botao.classList.remove("selecionada");
    }
    if (periodo != null && !ocupada) livres++;
  }

  // Resumo ("—" quando o período é inválido)
  pegar("disponiveis").textContent = periodo ? livres + " de " + vagas.length + " disponíveis" : "Defina o período";
  pegar("r-entrada").textContent = periodo ? dataHora(periodo.inicio) : "—";
  pegar("r-saida").textContent = periodo ? dataHora(periodo.fim) : "—";
  pegar("r-duracao").textContent = periodo ? Math.round((periodo.fim - periodo.inicio) / MS_POR_HORA) + " hora(s)" : "—";
  pegar("r-total").textContent = periodo ? moeda(periodo.valor) : "—";
  pegar("r-vaga").textContent = vagaEscolhida ? vagaEscolhida.codigo : "Escolha na planta";
  pegar("r-tipo").textContent = vagaEscolhida ? vagaEscolhida.tipo : "Carro, moto ou vaga acessível";

  // O botão só é liberado com período válido e vaga escolhida.
  pegar("continuar").disabled = periodo == null || vagaEscolhida == null;
  pegar("continuar").textContent = vagaEscolhida ? "Continuar com a vaga " + vagaEscolhida.codigo : "Selecione uma vaga";
}

// Mostra a etapa 1, 2 ou 3 e esconde as outras (o atributo "hidden" esconde o elemento).
function mostrarEtapa(numero) {
  etapaAtual = numero;
  pegar("tela-vaga").hidden = numero != 1;
  pegar("tela-confirmar").hidden = numero == 1;
  pegar("form-dados").hidden = numero != 2;
  pegar("form-pagamento").hidden = numero != 3;
  pegar("minhas").hidden = numero != 1;
  pegar("c-cliente").hidden = numero != 3;
  const itens = pegar("etapas").children;  // barra de progresso: "atual" na etapa em andamento, "feito" nas anteriores
  for (let i = 0; i < itens.length; i++) {
    itens[i].className = (i + 1 == numero) ? "atual" : (i + 1 < numero) ? "feito" : "";
  }
  window.scrollTo(0, 0);
}

pegar("tela-vaga").oninput = function () {  // qualquer mudança nos campos redesenha a tela
  pegar("aviso").hidden = true;
  atualizar();
};

pegar("tela-vaga").onsubmit = function (evento) {  // botão "Continuar"
  evento.preventDefault();  // impede o formulário de recarregar a página
  const periodo = calcularPeriodo();
  if (periodo == null || vagaEscolhida == null) return;
  pegar("c-vaga").textContent = vagaEscolhida.codigo;
  pegar("c-tipo").textContent = vagaEscolhida.tipo;
  pegar("c-mod").textContent = ehDiaria() ? "Diária de 24 h" : "Por horário";
  pegar("c-entrada").textContent = dataHora(periodo.inicio);
  pegar("c-saida").textContent = dataHora(periodo.fim);
  pegar("c-total").textContent = moeda(periodo.valor);
  mostrarEtapa(2);
};

pegar("voltar").onclick = function () { mostrarEtapa(etapaAtual - 1); };

// ----- 5) Etapa 2: seus dados -----

function mostrarErro(mensagem) {
  pegar("erro-dados").textContent = mensagem;
  pegar("erro-dados").hidden = false;
}

pegar("form-dados").onsubmit = function (evento) {  // botão "Ir para pagamento"
  evento.preventDefault();
  const periodo = calcularPeriodo();
  const nome = pegar("nome").value.trim();                  // trim() tira os espaços das pontas
  const telefone = pegar("telefone").value.trim();
  const placa = pegar("placa").value.trim().toUpperCase();  // toUpperCase() deixa em maiúsculas

  // Confere cada campo. Se algo estiver errado, mostra o erro e para (return).
  if (!nome.includes(" ")) return mostrarErro("Digite o nome e o sobrenome.");
  if (isNaN(telefone) || telefone.length < 10 || telefone.length > 11) return mostrarErro("Telefone: só números, com DDD (10 ou 11 dígitos).");
  if (placa.length != 7) return mostrarErro("A placa precisa ter 7 caracteres, como ABC1D23.");
  if (temConflito("placa", placa, periodo)) return mostrarErro("Essa placa já tem uma reserva nesse período.");

  pegar("erro-dados").hidden = true;
  pegar("c-nome").textContent = nome + " · " + placa;
  mostrarEtapa(3);
};

// ----- 6) Etapa 3: pagamento -----

const textosPagamento = {  // a chave é o "value" de cada opção no HTML
  cartao: "Cartão de crédito: você paga ao chegar ao estacionamento.",
  "google-wallet": "Google Wallet: pagamento apenas simulado.",
  pix: "Pix: veja o QR Code de demonstração (pagamento apenas simulado).",
  dinheiro: "Dinheiro: você paga ao chegar ao estacionamento."
};

function pagamentoEscolhido() {  // devolve a opção marcada (ex.: "pix") ou null
  const marcado = document.querySelector('input[name="pagamento"]:checked');
  return marcado ? marcado.value : null;
}

pegar("form-pagamento").onchange = function () {  // ao escolher uma forma: mostra o texto, o QR Code (só no Pix) e libera o botão
  const forma = pagamentoEscolhido();
  pegar("pg-titulo").textContent = "Forma escolhida";
  pegar("pg-texto").textContent = textosPagamento[forma];
  pegar("pix").hidden = forma != "pix";
  pegar("pagar").disabled = false;
};

pegar("form-pagamento").onsubmit = function (evento) {  // botão "Confirmar reserva": cria a reserva
  evento.preventDefault();
  const periodo = calcularPeriodo();
  if (periodo == null || temConflito("vaga", vagaEscolhida.codigo, periodo)) {  // confere de novo se a vaga continua livre
    mostrarEtapa(1);
    atualizar();
    return;
  }

  const reserva = {  // a reserva é um objeto com todos os dados
    vaga: vagaEscolhida.codigo,
    nome: pegar("nome").value.trim(),
    placa: pegar("placa").value.trim().toUpperCase(),
    pagamento: pagamentoEscolhido(),
    inicio: periodo.inicio,
    fim: periodo.fim,
    valor: periodo.valor,
    status: "ativa"  // depois pode virar "cancelada"
  };
  reservas.push(reserva);  // push coloca a reserva no final da lista
  salvarReservas();

  pegar("aviso").textContent = "Reserva da vaga " + reserva.vaga + " confirmada para " + reserva.nome + ". Total: " + moeda(reserva.valor) + ".";
  pegar("aviso").hidden = false;
  vagaEscolhida = null;  // limpa tudo para uma nova reserva
  pegar("form-dados").reset();
  pegar("form-pagamento").reset();
  pegar("pix").hidden = true;
  pegar("pagar").disabled = true;
  pegar("pg-titulo").textContent = "Escolha uma opção acima";
  pegar("pg-texto").textContent = "O total é o mesmo em todas as formas de pagamento.";
  mostrarEtapa(1);
  atualizar();
  listarReservas();
};

// ----- 7) Minhas reservas -----

function listarReservas() {  // desenha a lista (a mais nova primeiro)
  const lista = pegar("lista");
  lista.innerHTML = "";
  let ativas = 0;
  if (reservas.length == 0) lista.textContent = "Nenhuma reserva por enquanto. Selecione uma vaga para começar.";

  for (let i = reservas.length - 1; i >= 0; i--) {
    const reserva = reservas[i];
    if (reserva.status == "ativa") ativas++;

    const caixa = document.createElement("div");  // cada reserva vira uma caixa
    caixa.className = "recibo";
    const codigo = document.createElement("strong");
    codigo.className = "codigo";
    codigo.textContent = reserva.vaga;
    const detalhes = document.createElement("p");
    detalhes.textContent = reserva.nome + " · " + reserva.placa + " · " + dataHora(reserva.inicio) + " até " +
      dataHora(reserva.fim) + " · " + moeda(reserva.valor) + " · " + reserva.pagamento + " · " + reserva.status;
    caixa.append(codigo, detalhes);

    if (reserva.status == "ativa") {  // só reservas ativas têm o botão de cancelar
      const botao = document.createElement("button");
      botao.className = "botao";
      botao.textContent = "Cancelar reserva";
      botao.onclick = function () { cancelarReserva(reserva); };
      caixa.append(botao);
    }
    lista.append(caixa);
  }
  pegar("contador").textContent = ativas;
}

function cancelarReserva(reserva) {  // a reserva deixa de estar "ativa", então a vaga volta a ficar livre
  if (!confirm("Deseja cancelar a reserva da vaga " + reserva.vaga + "? Clique em OK para confirmar.")) return;
  reserva.status = "cancelada";
  salvarReservas();
  atualizar();
  listarReservas();
  // Troca a mensagem antiga ("reserva confirmada") por um aviso de cancelamento.
  pegar("aviso").textContent = "Reserva da vaga " + reserva.vaga + " cancelada. A vaga está livre de novo.";
  pegar("aviso").hidden = false;
}

// ----- 8) Tema e início do programa -----

// Botão de tema: liga e desliga a classe "escuro" no <body>. O CSS troca as cores por causa dela.
pegar("tema").onclick = function () {
  document.body.classList.toggle("escuro");
};

// A data já começa em hoje (formato AAAA-MM-DD), assim o período é válido e a planta não fica bloqueada.
const hoje = new Date();
let mes = hoje.getMonth() + 1;  // os meses começam em 0 (janeiro = 0), por isso somamos 1
let dia = hoje.getDate();
if (mes < 10) mes = "0" + mes;  // coloca o zero na frente: 5 vira "05"
if (dia < 10) dia = "0" + dia;
pegar("data").value = hoje.getFullYear() + "-" + mes + "-" + dia;
pegar("tarifas").textContent = "Valores de exemplo: " + moeda(VALOR_HORA) + " por hora ou " + moeda(VALOR_DIARIA) + " pela diária.";

mostrarEtapa(1);   // começa na etapa 1
atualizar();       // desenha a planta e o resumo
listarReservas();  // mostra as reservas já salvas
