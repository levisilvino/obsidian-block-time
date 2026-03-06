# Block Time Scheduler

Agenda visual para Obsidian com integração completa ao Tasks API, suporte completo a recorrências e cache otimizado.


## Recursos

- **Busca inteligente** — Encontra tasks em pastas configuráveis
- **Adiciona no calendário Automaticamente** — Adiciona tasks no calendário automaticamente com data e hora
- **Agenda visual** — Grid de horas diário e semanal
- **Tasks API v1** — Criação, edição e toggle via plugin Tasks
- **Recorrência completa** — Suporte total à sintaxe do plugin Tasks
- **Notificações** — Lembretes de horário e prazo desktop
- **Cache otimizado** — fileContentCache com métricas hits/misses

## Como usar

### Tasks Recorrentes (sem data)
- Crie: `- [ ] Reunião semanal 🔁 every week on Friday`
- Aparece automaticamente na próxima Sexta-feira
- Recorrência gerenciada pelo plugin Tasks (se instalado)

### Tasks com Data/Hora
- Crie: `- [ ] Reunião 🔁 every week 14h 📅 2025-10-24`
- Aparece no calendário na data e horário especificados

### Tasks Diárias
- Crie: `- [ ] Check email 🔁 every day`
- Aparece todos os dias sem precisar de data

## Screenshots
![plugin-gif](https://github.com/user-attachments/assets/ad564c77-96bc-4dcb-8c31-6f02d36c2818)

<img width="810" height="726" alt="Captura de tela 2026-03-05 050059" src="https://github.com/user-attachments/assets/a768d767-2077-404f-800a-7e6dea1642a7" />

<img width="773" height="782" alt="image" src="https://github.com/user-attachments/assets/a74efb1e-4923-4d49-9bd3-99f31807fbc8" />


## Instalação

### Manual
1. Baixe a [release mais recente](https://github.com/levisilvino/obsidian-block-time/releases)
2. Descompacte em `<vault>/.obsidian/plugins/block-time-scheduler/`
3. Reinicie o Obsidian
4. Ative em **Configurações → Community plugins**

### BRAT (Beta)
```
brat install levisilvino obsidian-block-time
```

## 🔄 Integração Tasks API

### Criação de tasks
- **Clique em slot vazio** → Abre modal Tasks → Salva no Daily Note
- **Duplo-clique em bloco** → Edita task existente via modal Tasks

### Toggle completion
- **Checkbox** → Usa Tasks API (recorrência automática) ou fallback manual
- **Compatibilidade total** → Funciona com ou sem plugin Tasks instalado

### Gerenciamento de recorrência
- **Com Tasks API** → Plugin Tasks gerencia criação da próxima ocorrência
- **Sem Tasks API** → Block Time Scheduler usa fallback manual
- **Formatos compatíveis** → 100% alinhado com sintaxe do Tasks plugin

> **Importante**: Requer plugin **Tasks** (`obsidian-tasks-plugin`) para criação/edição avançada. Toggle funciona sem ele.

## ⚙️ Configuração

Acesse **Configurações → Community plugins → Block Time Scheduler**:

### Agenda
- **Horas exibidas** — Início (0-12) e término (18-24)
- **Visualização padrão** — Diária ou semanal
- **Pastas a escanear** — Separado por vírgula (vazio = vault inteiro)

### Aparência
- **Tema Obsidian** — Herda cores do tema ativo

### Notificações
- **Horário** — Notificação no momento + X minutos antes
- **Prazos** — X dias antes + no dia (tags configuráveis)
- **Templates** — Textos personalizáveis com placeholders

### Placeholders
- `{task}` — Nome da tarefa
- `{min}` — Minutos antes
- `{days}` — Dias restantes
- `{time}` — Horário
- `{endTime}` — Horário de término
- `{file}` — Arquivo
- `{date}` — Data

## ️ Desenvolvimento

```bash
# Clone
git clone https://github.com/levisilvino/obsidian-block-time.git
cd obsidian-block-time

# Instalar
npm install

# Desenvolvimento
npm run dev

# Build
npm run build
```

## 📊 Performance

- **Cache** — fileContentCache com invalidação reativa
- **Métricas** — Console logs de hits/misses para tuning
- **Scan folders** — Configurável para vaults grandes
- **Debounce** — 800ms para evitar renders excessivos

## 🤝 Contribuição

Pull requests são bem-vindos!

1. Fork o projeto
2. Crie branch feature (`git checkout -b feature/nova-funcionalidade`)
3. Commit (`git commit -m 'Add nova funcionalidade'`)
4. Push (`git push origin feature/nova-funcionalidade`)
5. Abra Pull Request

## 📄 Licença

MIT License — veja arquivo [LICENSE](LICENSE)

## 🙏 Agradecimentos

- Plugin [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) — API v1
- Comunidade Obsidian — feedback e sugestões

## 🔗 Links

- [GitHub](https://github.com/levisilvino/obsidian-block-time)
- [Issues](https://github.com/levisilvino/obsidian-block-time/issues)
- [Releases](https://github.com/levisilvino/obsidian-block-time/releases)
