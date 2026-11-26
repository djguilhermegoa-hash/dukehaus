# Duke Haus

O site em [dukehaus.com.br](https://dukehaus.com.br/) usa GitHub Pages. A Blipy fornece a programação e vende os ingressos. A planilha privada **DUKE HAUS — LISTAS DE CONVIDADOS** concentra as inscrições e configurações das listas.

## Operação pelo Google Planilhas

### Aniversariantes do mês

Os próximos eventos elegíveis aparecem automaticamente no formulário. O sistema compara o mês de nascimento com o mês do evento usando o horário de Brasília. O prazo padrão termina no início do evento. Na aba **EVENTOS**, use **Aniversariantes** para excluir um evento com `Não` e **Limite aniversariantes** e **Encerramento aniversariantes** para ajustar a capacidade e o prazo. Campos de limite em branco deixam as inscrições sem limite de vagas.

As linhas dos eventos **Férias Proibidas** e **Segunda Eu Paro**, em 27 e 28 de novembro de 2026, são vinculadas automaticamente pelos IDs que a Blipy publicou. A coluna de ID permite localizar as regras mesmo após uma mudança no título.

### Criar ou alterar uma Lista OFF

1. Na aba **CONFIGURAÇÕES**, preencha uma linha. Use um **ID da lista** exclusivo, como `off-sexta`, e copie o **ID do evento** da aba **EVENTOS**. Informe título e descrição.
2. Defina **Visibilidade** como `Pública` ou `Privada`. Escolha `Oculto`, `Opcional` ou `Obrigatório` em **WhatsApp**. Nome e reconhecimento do aviso de privacidade são obrigatórios. Preencher **Código de convite** torna o código obrigatório. A comparação diferencia maiúsculas e minúsculas.
3. Preencha os campos desejados de vagas, abertura, encerramento, entrada e confirmação. Use datas e horas de Brasília no formato `dd/mm/aaaa hh:mm`. Se a abertura estiver vazia, a ativação abre a lista. Se o encerramento estiver vazio, as inscrições terminam no início do evento. **Entrada OFF até** também aceita `HH:mm`; se for um horário menor que o início do evento, conta como o dia seguinte. Uma lista não recebe inscrições depois do fim do evento ou do horário limite de entrada.
4. Marque **Ativa**. Desmarque a caixa para encerrar imediatamente. Uma lista pública só aparece durante sua janela de inscrição. A página principal oculta a Lista OFF quando não há opções públicas ativas.
5. Para uma lista privada, execute **Duke Haus → Gerar links privados** no menu da planilha e envie o **Link privado** apenas às pessoas convidadas. Use um código adicional quando quiser restringir o uso de links encaminhados. Para trocar o endereço, desoculte a coluna **Token privado**, limpe o token dessa lista e gere o link novamente.

Para uma festa privada fora da Blipy, use um ID exclusivo com prefixo `privado-` em **EVENTOS** e preencha **Nome do evento privado**, **Início do evento privado** e **Fim do evento privado**. Vincule esse ID em **CONFIGURAÇÕES**.

### Consultar inscritos

Abra **ANIVERSARIANTES** ou **LISTA OFF**. Use os filtros de **ID do evento**, **Nome do evento**, **ID da lista**, **Modalidade** ou **Status**. Troque o status de uma inscrição para `CANCELADA` se precisar liberar a vaga. Preserve os cabeçalhos. Mantenha a planilha com acesso geral **Restrito** e conceda acesso apenas à equipe que opera as listas.

Os formulários mostram a finalidade da coleta e o contato da Duke Haus. Remova os dados da planilha quando deixarem de ser necessários para a operação da lista ou seus atendimentos. Trate os links privados e códigos de convite como dados de acesso da lista.

## Programação automática

O workflow **Programação Duke Haus** roda a cada 30 minutos, aos minutos 05 e 35, sujeito à fila do GitHub. Para atualizar imediatamente, acesse **Actions → Programação Duke Haus → Run workflow**, selecione `main` e confirme. A etapa **Sincronizar programação da Blipy** registra as falhas. Se a Blipy falhar ou responder em um formato inesperado, o workflow encerra antes da publicação e o Pages continua servindo a última agenda válida. Alterações no site serão publicadas no próximo ciclo bem-sucedido.

Para testar ou atualizar o arquivo local, execute na raiz do repositório:

```sh
python3 -B scripts/sync_blipy.py
```

O coletor usa as páginas públicas do [organizador](https://projetoblippy.vercel.app/organizador/duke-haus) e dos eventos, seguindo os links de compra e das mídias originais exibidos pela Blipy. A consulta lê até 40 eventos por ciclo e não usa login. A investigação encontrou as [políticas públicas da Blipy](https://projetoblippy.vercel.app/politicas) e as páginas renderizadas. Uma API pública documentada de eventos não foi localizada. Descrições oferecidas como arte na origem têm um link para a imagem e um resumo de texto quando disponível.

Se o formato da Blipy mudar, peça ao desenvolvedor um feed de leitura do organizador `duke-haus` com autorização, regras de uso e limites compatíveis com consultas a cada 30 minutos. Solicite IDs estáveis, status de publicação, cancelamento e venda, início e fim com fuso, descrição, mídia original, menor preço vigente com moeda e taxas, URL individual de compra e regras de paginação.

Se o GitHub pausar agendamentos por inatividade do repositório, abra **Actions → Programação Duke Haus** e use **Enable workflow**. [Comportamento de workflows agendados](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Implantação e recuperação

1. Em uma planilha particular, abra **Extensões → Apps Script**. Cole `apps-script/Code.gs` no arquivo de código. Nas configurações do projeto, habilite a exibição de `appsscript.json` e use o manifesto do repositório.
2. Execute `configurarPlanilha` uma vez no editor. O Google solicitará autorização para Planilhas, requisições externas e acionadores. A função prepara as abas, os filtros, o fuso e o acionador de atualização de eventos. Reabra a planilha para carregar o menu **Duke Haus**.
3. Selecione **Implantar → Nova implantação → App da Web**. Escolha **Executar como eu** e **Quem pode acessar → Qualquer pessoa** para aceitar formulários de visitantes sem conta Google. Mantenha o compartilhamento da planilha **Restrito**. Copie a URL pública terminada em `/exec` em `listsEndpoint`, no arquivo `assets/duke-config.js`. A URL `/dev` é reservada aos editores. Para publicar alterações de código do backend, atualize a implantação existente para uma nova versão.
4. Em **GitHub → Settings → Pages**, selecione **GitHub Actions** como fonte de publicação. O workflow usa o domínio já configurado. Faça o merge na `main`, acompanhe o workflow e confira o site e `data/events.json` no domínio público. [Configuração do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
5. Depois da primeira publicação, execute **Duke Haus → Atualizar eventos** caso queira atualizar a aba **EVENTOS** imediatamente. O acionador faz essa atualização periodicamente. Para um domínio de teste, configure as propriedades opcionais `DUKE_SITE_URL` e `DUKE_EVENT_FEED_URL` no editor do Apps Script. Remova essas propriedades para voltar ao domínio de produção.

O navegador envia os formulários como `application/x-www-form-urlencoded`, segue o redirecionamento do Google e só mostra sucesso ao receber o identificador confirmado. A URL pública do aplicativo recebe inscrições e devolve opções de lista e recibos. O endpoint não fornece consulta de inscritos. As chaves geradas pelo Apps Script ficam nas propriedades do projeto. [Redirecionamentos do Content Service](https://developers.google.com/apps-script/guides/content#redirects).

### Diagnóstico

- **Programação antiga**. Confira a data `syncedAt` no `data/events.json` publicado e o resultado da sincronização em **Actions**. Se o Pages estiver configurado para publicar de uma branch, mude a fonte para GitHub Actions e execute o workflow.
- **Formulários indisponíveis**. Verifique se `listsEndpoint` termina em `/exec`. Abra a URL com `?action=catalog` em uma janela anônima e confirme que retorna JSON, em vez de uma página de login. Consulte **Execuções** no editor do Apps Script para conferir erros. A conta pode restringir apps acessíveis anonimamente; nesse caso, a publicação precisa de uma conta Google que permita a opção **Qualquer pessoa**.
- **Eventos ausentes no formulário**. A aba **EVENTOS** traz as regras e espelha a programação. O backend usa a programação publicada como fonte dos próximos eventos. Verifique o feed, a regra do evento e os horários. Para a Lista OFF, confira também **Ativa**, visibilidade e a janela de inscrição.
- **Envio sem confirmação**. Mantenha a página aberta e tente novamente. O mesmo envio pode recuperar a confirmação sem gravar outra linha. Confirme o registro na aba da modalidade pelo nome e pelo evento.

### Testes locais

```sh
python3 -B -m unittest discover -s tests -p 'test_sync_blipy.py' -v
node --test tests/apps-script.test.mjs
python3 -m http.server 8000
```

Abra `http://localhost:8000/` para ver a página com o `data/events.json` local. Para testar o transporte real quando o Apps Script estiver implantado, use o endereço `/exec` com `?action=catalog` e faça um envio autorizado com dados de teste. Confirme a linha correspondente na planilha, a resposta JSON e o redirecionamento para `script.googleusercontent.com` no painel de rede do navegador. Um `curl -L` sozinho não confirma a política CORS do navegador.
