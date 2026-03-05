import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	ItemView,
	TFile,
	TFolder,
	Notice,
	moment
} from "obsidian";

// ============================================================================
// INTERFACES E TIPOS
// ============================================================================

interface BlockTimeSettings {
	startHour: number;
	endHour: number;
	defaultView: "day" | "week";
	taskPattern: string;
	useObsidianTheme: boolean;
	enableNotifications: boolean;
	enableReminderBefore: boolean;
	reminderMinutesBefore: number;
	enableDeadlineReminders: boolean;
	deadlineTags: string;
	deadlineReminderDays: number;
	deadlineReminderHour: number;
	notifyTextEarlyTask: string;
	notifyTextOnTimeTask: string;
	notifyTextDeadlineEarly: string;
	notifyTextDeadlineNow: string;
	notifyTextDeadlineToday: string;
	notifyTextDeadlineDays: string;
	scanFolders: string;
}

const DEFAULT_SETTINGS: BlockTimeSettings = {
	startHour: 6,
	endHour: 22,
	defaultView: "day",
	taskPattern: "- \\[.\\]",
	useObsidianTheme: true,
	enableNotifications: true,
	enableReminderBefore: true,
	reminderMinutesBefore: 15,
	enableDeadlineReminders: true,
	deadlineTags: "#prazo, #deadline",
	deadlineReminderDays: 3,
	deadlineReminderHour: 9,
	notifyTextEarlyTask: "⏰ Em {min} min: {task}",
	notifyTextOnTimeTask: "📅 Agora: {task}",
	notifyTextDeadlineEarly: "🚨 Prazo em {min} min: {task}",
	notifyTextDeadlineNow: "🚨 Prazo AGORA: {task}",
	notifyTextDeadlineToday: "🚨 Prazo HOJE: {task}",
	notifyTextDeadlineDays: "⚠️ Prazo em {days} dia(s): {task}",
	scanFolders: ""
};

interface ParsedTask {
	text: string;
	date: Date | null;
	startTime: string | null;
	endTime: string | null;
	duration: number; // em minutos
	completed: boolean;
	filePath: string;
	line: number;
	priority: "high" | "medium" | "low" | "none";
	rawLine: string;
	recurrence: string | null; // ex: "every day", "every week when done"
}

// ============================================================================
// TASKS PLUGIN API V1
// ============================================================================

interface TasksApiV1 {
	createTaskLineModal(): Promise<string>;
	editTaskLineModal(taskLine: string): Promise<string>;
	executeToggleTaskDoneCommand(line: string, path: string): string;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const VIEW_TYPE_BLOCK_TIME = "block-time-view";

// ============================================================================
// PLUGIN PRINCIPAL
// ============================================================================

export default class BlockTimeSchedulerPlugin extends Plugin {
	settings: BlockTimeSettings;
	private notificationInterval: ReturnType<typeof setInterval> | null = null;
	private firedNotifications: Set<string> = new Set();
	private lastResetDate: string = "";
	fileContentCache: Map<string, string> = new Map();

	async onload() {
		await this.loadSettings();

		// Registra a View customizada
		this.registerView(
			VIEW_TYPE_BLOCK_TIME,
			(leaf) => new BlockTimeView(leaf, this)
		);

		// Comando para abrir a agenda como nota inteira
		this.addCommand({
			id: "open-block-time-scheduler",
			name: "Abrir Agenda Block Time",
			callback: () => {
				this.activateView("tab");
			}
		});

		// Comando para abrir na barra lateral
		this.addCommand({
			id: "open-block-time-sidebar",
			name: "Abrir Agenda Block Time (Lateral)",
			callback: () => {
				this.activateView("sidebar");
			}
		});

		// Ícone na ribbon — abre como nota inteira
		this.addRibbonIcon("calendar-clock", "Block Time Scheduler", () => {
			this.activateView("tab");
		});

		// Aba de configurações
		this.addSettingTab(new BlockTimeSettingTab(this.app, this));

		// Cache de conteúdo: invalida quando arquivo é modificado/removido/renomeado
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) this.fileContentCache.delete(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) this.fileContentCache.delete(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.fileContentCache.delete(oldPath);
				if (file instanceof TFile) this.fileContentCache.delete(file.path);
			})
		);

		// Inicia sistema de notificações
		this.startNotificationScheduler();

		console.log("Block Time Scheduler carregado!");
	}

	onunload() {
		this.stopNotificationScheduler();
		this.fileContentCache.clear();
		console.log("Block Time Scheduler descarregado!");
	}

	getTasksApi(): TasksApiV1 | null {
		try {
			const tasksPlugin = (this.app as any).plugins?.plugins?.["obsidian-tasks-plugin"];
			return tasksPlugin?.apiV1 ?? null;
		} catch {
			return null;
		}
	}

	// ========================================================================
	// SISTEMA DE NOTIFICAÇÕES
	// ========================================================================

	startNotificationScheduler() {
		this.stopNotificationScheduler();
		this.firedNotifications.clear();
		this.lastResetDate = new Date().toDateString();
		// Verifica a cada 60 segundos (tolerância de ±2min cobre o intervalo)
		this.notificationInterval = setInterval(() => {
			this.checkAndFireNotifications();
		}, 60000);
		// Verifica imediatamente ao iniciar
		setTimeout(() => this.checkAndFireNotifications(), 5000);
	}

	stopNotificationScheduler() {
		if (this.notificationInterval) {
			clearInterval(this.notificationInterval);
			this.notificationInterval = null;
		}
	}

	private async checkAndFireNotifications() {
		if (!this.settings.enableNotifications) return;

		// Reset diário automático das notificações disparadas
		const todayStr = new Date().toDateString();
		if (this.lastResetDate !== todayStr) {
			this.firedNotifications.clear();
			this.lastResetDate = todayStr;
		}

		const taskParser = new TaskParser(this.app, this.settings, this.fileContentCache);
		const now = new Date();

		// Busca todas as tasks UMA vez e reutiliza
		const allTasks = await taskParser.getAllTasks();
		const todayTasks = allTasks.filter(t => t.date && taskParser.isSameDay(t.date, now));

		// === Notificações de horário ===
		for (const task of todayTasks) {
			if (task.completed || !task.startTime) continue;

			const [taskHour, taskMin] = task.startTime.split(":").map(Number);
			const taskTime = new Date(now);
			taskTime.setHours(taskHour, taskMin, 0, 0);

			const diffMs = taskTime.getTime() - now.getTime();
			const diffMin = Math.round(diffMs / 60000);

			// Notificação antecipada
			if (this.settings.enableReminderBefore && this.settings.reminderMinutesBefore > 0) {
				const earlyId = `early-${task.filePath}:${task.line}-${task.startTime}`;
				if (!this.firedNotifications.has(earlyId)) {
					if (diffMin > 0 && diffMin <= this.settings.reminderMinutesBefore) {
						this.fireNotification(
							this.renderTemplate(this.settings.notifyTextEarlyTask, task, diffMin),
							`Às ${task.startTime}${task.endTime ? " - " + task.endTime : ""}`,
							earlyId
						);
					}
				}
			}

			// Notificação no horário
			const onTimeId = `ontime-${task.filePath}:${task.line}-${task.startTime}`;
			if (!this.firedNotifications.has(onTimeId)) {
				if (diffMin <= 0 && diffMin >= -2) {
					this.fireNotification(
						this.renderTemplate(this.settings.notifyTextOnTimeTask, task),
						`Horário: ${task.startTime}${task.endTime ? " - " + task.endTime : ""}`,
						onTimeId
					);
				}
			}
		}

		// === Notificações de prazo ===
		this.checkDeadlineNotifications(allTasks, now);
	}

	private checkDeadlineNotifications(allTasks: ParsedTask[], now: Date) {
		if (!this.settings.enableDeadlineReminders) return;

		const tags = this.settings.deadlineTags
			.split(",")
			.map(t => t.trim().toLowerCase())
			.filter(t => t.length > 0);
		if (tags.length === 0) return;

		for (const task of allTasks) {
			if (task.completed || !task.date) continue;

			// Verifica se a rawLine contém alguma das tags cadastradas
			const rawLower = task.rawLine.toLowerCase();
			const hasTag = tags.some(tag => rawLower.includes(tag));
			if (!hasTag) continue;

			// Calcula dias restantes
			const deadlineDate = new Date(task.date);
			deadlineDate.setHours(0, 0, 0, 0);
			const today = new Date(now);
			today.setHours(0, 0, 0, 0);
			const diffDays = Math.round((deadlineDate.getTime() - today.getTime()) / 86400000);

			if (diffDays < 0) continue; // já passou

			// === PRAZO HOJE + TEM HORÁRIO → notifica X min antes ===
			if (diffDays === 0 && task.startTime) {
				const [tH, tM] = task.startTime.split(":").map(Number);
				const taskTime = new Date(now);
				taskTime.setHours(tH, tM, 0, 0);
				const diffMin = Math.round((taskTime.getTime() - now.getTime()) / 60000);

				// Notificação X min antes do horário do prazo
				const earlyDeadlineId = `deadline-early-${task.filePath}:${task.line}-${task.startTime}`;
				if (!this.firedNotifications.has(earlyDeadlineId)) {
					if (diffMin > 0 && diffMin <= this.settings.reminderMinutesBefore) {
						this.fireNotification(
							this.renderTemplate(this.settings.notifyTextDeadlineEarly, task, diffMin),
							`Às ${task.startTime}${task.endTime ? " - " + task.endTime : ""} • ${task.filePath.split("/").pop()}`,
							earlyDeadlineId
						);
					}
				}

				// Notificação no horário exato do prazo
				const onTimeDeadlineId = `deadline-ontime-${task.filePath}:${task.line}-${task.startTime}`;
				if (!this.firedNotifications.has(onTimeDeadlineId)) {
					if (diffMin <= 0 && diffMin >= -2) {
						this.fireNotification(
							this.renderTemplate(this.settings.notifyTextDeadlineNow, task),
							`Horário: ${task.startTime}${task.endTime ? " - " + task.endTime : ""} • ${task.filePath.split("/").pop()}`,
							onTimeDeadlineId
						);
					}
				}
			}

			// === PRAZO HOJE + SEM HORÁRIO → notifica uma vez na hora configurada ===
			if (diffDays === 0 && !task.startTime && now.getHours() >= this.settings.deadlineReminderHour) {
				const deadlineId = `deadline-${task.filePath}:${task.line}`;
				if (!this.firedNotifications.has(deadlineId)) {
					this.fireNotification(
						this.renderTemplate(this.settings.notifyTextDeadlineToday, task),
						`Arquivo: ${task.filePath.split("/").pop()}`,
						deadlineId
					);
				}
			}

			// === PRAZO EM X DIAS → notifica na hora configurada ===
			if (diffDays > 0 && diffDays <= this.settings.deadlineReminderDays && now.getHours() >= this.settings.deadlineReminderHour) {
				const deadlineId = `deadline-${task.filePath}:${task.line}`;
				if (!this.firedNotifications.has(deadlineId)) {
					this.fireNotification(
						this.renderTemplate(this.settings.notifyTextDeadlineDays, task, undefined, diffDays),
						`Vence em ${this.formatDateStr(deadlineDate)} • ${task.filePath.split("/").pop()}`,
						deadlineId
					);
				}
			}
		}
	}

	private renderTemplate(template: string, task: ParsedTask, diffMin?: number, diffDays?: number): string {
		return template
			.replace(/\{task\}/g, task.text)
			.replace(/\{min\}/g, diffMin !== undefined ? String(diffMin) : "")
			.replace(/\{days\}/g, diffDays !== undefined ? String(diffDays) : "")
			.replace(/\{time\}/g, task.startTime || "")
			.replace(/\{endTime\}/g, task.endTime || "")
			.replace(/\{file\}/g, task.filePath.split("/").pop() || "")
			.replace(/\{date\}/g, task.date ? this.formatDateStr(task.date) : "");
	}

	private formatDateStr(date: Date): string {
		return `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}`;
	}

	private fireNotification(title: string, body: string, id: string) {
		this.firedNotifications.add(id);

		// Notificação in-app do Obsidian
		new Notice(`${title}\n${body}`, 10000);

		// Notificação nativa do sistema operacional (aparece mesmo fora do Obsidian)
		try {
			const electron = require("electron");
			const ElectronNotif = electron?.remote?.Notification ?? electron?.Notification;
			if (ElectronNotif) {
				const notif = new ElectronNotif({ title, body, silent: false });
				notif.show();
				return;
			}
		} catch (e) {
			// Electron não disponível, tenta Web API
		}

		// Fallback: Web Notification API
		if ("Notification" in window) {
			if (Notification.permission === "granted") {
				new Notification(title, { body });
			} else if (Notification.permission !== "denied") {
				Notification.requestPermission().then(permission => {
					if (permission === "granted") {
						new Notification(title, { body });
					}
				});
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView(mode: "tab" | "sidebar" = "tab") {
		const { workspace } = this.app;

		// Fecha views existentes para reabrir no modo correto
		workspace.getLeavesOfType(VIEW_TYPE_BLOCK_TIME).forEach(l => l.detach());

		let leaf: WorkspaceLeaf | null = null;
		if (mode === "sidebar") {
			leaf = workspace.getRightLeaf(false);
		} else {
			leaf = workspace.getLeaf("tab");
		}

		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_BLOCK_TIME,
				active: true
			});
			workspace.revealLeaf(leaf);
		}
	}
}

// ============================================================================
// TASK PARSER - Lê e parseia tarefas do vault
// ============================================================================

class TaskParser {
	app: App;
	settings: BlockTimeSettings;
	private contentCache: Map<string, string>;
	private cacheHits = 0;
	private cacheMisses = 0;

	constructor(app: App, settings: BlockTimeSettings, contentCache?: Map<string, string>) {
		this.app = app;
		this.settings = settings;
		this.contentCache = contentCache || new Map();
	}

	private async readFile(file: TFile): Promise<string> {
		const path = file.path;
		if (this.contentCache.has(path)) {
			this.cacheHits++;
			return this.contentCache.get(path)!;
		}

		this.cacheMisses++;
		const content = await this.app.vault.cachedRead(file);
		this.contentCache.set(path, content);
		return content;
	}

	async getAllTasks(): Promise<ParsedTask[]> {
		this.cacheHits = 0;
		this.cacheMisses = 0;
		const tasks: ParsedTask[] = [];
		const allFiles = this.app.vault.getMarkdownFiles();

		// Filtra por pastas configuradas (vazio = vault inteiro)
		const scanFolders = this.settings.scanFolders
			.split(",")
			.map(f => f.trim().replace(/^\/+|\/+$/g, ""))
			.filter(f => f.length > 0);

		const files = scanFolders.length > 0
			? allFiles.filter(f => scanFolders.some(folder => f.path.startsWith(folder + "/") || f.path === folder))
			: allFiles;

		for (const file of files) {
			const content = await this.readFile(file);
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const task = this.parseLine(line, file.path, i + 1);
				if (task) {
					tasks.push(task);
				}
			}
		}

		// Métrica de cache para tuning
		const total = this.cacheHits + this.cacheMisses;
		const hitRate = total > 0 ? ((this.cacheHits / total) * 100).toFixed(1) : "0";
		console.debug(`[BlockTime] Cache: ${this.cacheHits} hits / ${this.cacheMisses} misses (${hitRate}% hit rate) | ${files.length} arquivos | ${tasks.length} tasks`);

		// Filtra tasks [ ] + 🔁 sem data que já foram completadas hoje (apenas se não existir task pendente)
		const today = new Date();
		return tasks.filter(task => {
			// Se não é pendente + recorrente + sem data, mantém
			if (task.completed || !task.recurrence || this.hasExplicitDate(task.rawLine)) return true;

			// Verifica se existe [x] + 🔁 + ✅ hoje E não existe [ ] + 🔁 no mesmo arquivo
			const hasDoneToday = tasks.some(other =>
				other.completed &&
				other.recurrence &&
				other.filePath === task.filePath &&
				other.text === task.text &&
				!this.hasExplicitDate(other.rawLine) &&
				this.parseDoneDate(other.rawLine) !== null &&
				this.isSameDay(this.parseDoneDate(other.rawLine)!, today)
			);
			
			// Se foi completada hoje, verifica se ainda existe task pendente
			if (hasDoneToday) {
				const hasPending = tasks.some(other =>
					!other.completed &&
					other.recurrence &&
					other.filePath === task.filePath &&
					other.text === task.text &&
					!this.hasExplicitDate(other.rawLine)
				);
				return hasPending; // Mantém apenas se ainda existe task pendente
			}
			
			return true; // Mantém se não foi completada hoje
		});
	}

	async getTasksForDate(targetDate: Date): Promise<ParsedTask[]> {
		const allTasks = await this.getAllTasks();
		const tasks: ParsedTask[] = [];
		const seenTaskKeys = new Set<string>();
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// 1. Adiciona TODAS as tarefas existentes com data explícita (incluindo completadas)
		// SEMPRE adiciona tasks com data explícita, sem filtros
		for (const task of allTasks) {
			// Verifica se tem data explícita OU data de conclusão
			const hasExplicitDate = task.date && this.isSameDay(task.date, targetDate);
			const hasDoneDate = this.parseDoneDate(task.rawLine) && this.isSameDay(this.parseDoneDate(task.rawLine)!, targetDate);
			
			if (hasExplicitDate || hasDoneDate) {
				// Usa linha completa como chave para distinguir recorrências diferentes
				const taskKey = `${task.rawLine.trim()}_${task.filePath}`;
				tasks.push(task);
				seenTaskKeys.add(taskKey);
			}
		}

		// 2. Expande recorrências para preencher calendário completo
		for (const task of allTasks) {
			if (!task.recurrence) continue;

			// Usa texto base (sem checkbox e data de conclusão) como chave
			const baseTaskText = task.rawLine.replace(/^(\s*)-\s*\[[xX]\]\s*/, "").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trim();
			const taskKey = `${baseTaskText}_${task.filePath}`;
			
			// Pula se já existe uma task com este texto base neste dia
			if (seenTaskKeys.has(taskKey)) continue;

			// Verifica se existe uma task pendente (não completada) para esta recorrência
			// Se só existem versões completadas, a recorrência foi encerrada
			const hasPendingTask = allTasks.some(t => 
				!t.completed && 
				t.recurrence &&
				t.rawLine.replace(/^(\s*)-\s*\[[xX]\]\s*/, "").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trim() === baseTaskText
			);

			// Verifica se a recorrência deve aparecer nesta data
			if (this.shouldRecurOnDate(task, targetDate)) {
				// Busca se existe versão completada nesta data específica
				const completedVersion = await this.findCompletedTask(task, targetDate);
				
				if (completedVersion) {
					// Se existe versão completada, mostra apenas ela
					tasks.push(completedVersion);
					seenTaskKeys.add(taskKey);
				} else if (hasPendingTask && (targetDate >= today || !this.hasExplicitDate(task.rawLine))) {
					// Se existe task pendente E (é data futura OU é recorrência sem data), gera ocorrência prevista
					const generatedTask = this.createRecurrenceInstance(task, targetDate);
					tasks.push(generatedTask);
					seenTaskKeys.add(taskKey);
				}
				// Se não existe task pendente, não gera ocorrências futuras (recorrência encerrada)
			}
		}

		return tasks;
	}

	private shouldRecurOnDate(task: ParsedTask, targetDate: Date): boolean {
		if (!task.recurrence) return false;
		const recurrenceRule = task.recurrence.toLowerCase().trim();
		
		// Data de início da recorrência
		let startDate = task.date;
		if (!startDate) {
			// Se não tem data, usa 30 dias atrás como referência
			startDate = new Date();
			startDate.setDate(startDate.getDate() - 30);
		}

		// Não aparece antes da data de início
		if (targetDate < startDate) return false;

		// Every day
		if (/every\s+day/i.test(recurrenceRule)) return true;
		
		// Every week
		if (/every\s+week/i.test(recurrenceRule)) {
			return startDate.getDay() === targetDate.getDay();
		}

		// Every month (sem número)
		if (/every\s+month/i.test(recurrenceRule)) {
			return startDate.getDate() === targetDate.getDate();
		}

		// Every N days/weeks/months/years
		const nMatch = recurrenceRule.match(/every\s+(\d+)\s+(day|week|month|year)s?/i);
		if (nMatch) {
			const n = parseInt(nMatch[1]);
			const unit = nMatch[2].toLowerCase();
			const diffDays = Math.floor((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			
			if (unit === "day" && diffDays >= 0 && diffDays % n === 0) return true;
			if (unit === "week" && diffDays >= 0 && diffDays % (n * 7) === 0) return true;
			if (unit === "month") {
				const monthsDiff = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + 
								(targetDate.getMonth() - startDate.getMonth());
				return monthsDiff >= 0 && monthsDiff % n === 0 && 
					   targetDate.getDate() === startDate.getDate();
			}
			if (unit === "year") {
				const yearsDiff = targetDate.getFullYear() - startDate.getFullYear();
				return yearsDiff >= 0 && yearsDiff % n === 0 &&
					   targetDate.getMonth() === startDate.getMonth() &&
					   targetDate.getDate() === startDate.getDate();
			}
		}

		// Every weekday
		if (/every\s+weekday/i.test(recurrenceRule)) {
			const dayOfWeek = targetDate.getDay();
			return dayOfWeek >= 1 && dayOfWeek <= 5;
		}

		// Every Monday/Tuesday/etc
		const dayNames: Record<string, number> = {
			sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
			thursday: 4, friday: 5, saturday: 6
		};
		const dayMatch = recurrenceRule.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
		if (dayMatch) {
			const targetDay = dayNames[dayMatch[1].toLowerCase()];
			return targetDate.getDay() === targetDay;
		}

		return false;
	}

	private async findCompletedTask(task: ParsedTask, targetDate: Date): Promise<ParsedTask | null> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.filePath);
			if (!(file instanceof TFile)) return null;

			const content = await this.readFile(file);
			const lines = content.split("\n");
			const targetDateStr = this.formatDate(targetDate);

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				
				const taskMatch = line.match(/^(\s*)-\s*\[x\]\s*(.*)$/);
				if (!taskMatch) continue;

				const completedTaskText = taskMatch[2];
				
				// Compara estrutura (remove checkbox e data de conclusão)
				const originalText = task.rawLine.replace(/^(\s*)-\s*\[[xX]\]\s*/, "").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trim();
				const completedText = completedTaskText.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trim();
				
				if (originalText === completedText) {
					const doneDateMatch = line.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
					if (doneDateMatch && doneDateMatch[1] === targetDateStr) {
						return this.parseLine(line, task.filePath, i + 1);
					}
				}
			}

			return null;
		} catch (error) {
			console.warn("[BlockTime] Erro ao buscar tarefa completada:", error);
			return null;
		}
	}

	private createRecurrenceInstance(task: ParsedTask, targetDate: Date): ParsedTask {
		return {
			...task,
			date: new Date(targetDate),
			completed: false,
			line: -1 // Indica que é gerada
		};
	}

	async getTasksForWeek(startDate: Date): Promise<ParsedTask[]> {
		const tasks: ParsedTask[] = [];
		const seenTaskKeys = new Set<string>();

		// Processa cada dia da semana
		for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
			const currentDay = new Date(startDate);
			currentDay.setDate(startDate.getDate() + dayOffset);

			// Usa a mesma lógica do getTasksForDate para este dia específico
			const dayTasks = await this.getTasksForDate(currentDay);
			
			// Adiciona as tasks do dia, evitando duplicatas na semana
			for (const task of dayTasks) {
				const taskKey = `${task.text.trim()}_${task.filePath}_${currentDay.toDateString()}`;
				if (!seenTaskKeys.has(taskKey)) {
					tasks.push(task);
					seenTaskKeys.add(taskKey);
				}
			}
		}

		return tasks;
	}

	private parseLine(line: string, filePath: string, lineNumber: number): ParsedTask | null {
		// Detecta se é uma tarefa (checkbox)
		const taskMatch = line.match(/^(\s*)-\s*\[([ xX])\]\s*(.*)$/);
		if (!taskMatch) return null;

		const completed = taskMatch[2].toLowerCase() === "x";
		let taskText = taskMatch[3];

		// Parse de data - múltiplos formatos suportados
		const dateInfo = this.parseDate(taskText);
		const timeInfo = this.parseTime(taskText);
		const priority = this.parsePriority(taskText);
		const recurrence = this.parseRecurrence(taskText);

		// Task com sem data = tarefa diária (aparece hoje), somente se não completada
		let taskDate = dateInfo.date;
		if (!taskDate && recurrence && !completed) {
			taskDate = new Date();
		} else if (!taskDate && recurrence && completed) {
			// Se está completada e tem ✅ data, usa essa data
			const doneDate = this.parseDoneDate(line);
			taskDate = doneDate;
		}

		// Remove marcadores do texto para exibição limpa
		taskText = this.cleanTaskText(taskText);

		return {
			text: taskText,
			date: taskDate,
			startTime: timeInfo.startTime,
			endTime: timeInfo.endTime,
			duration: timeInfo.duration,
			completed,
			filePath,
			line: lineNumber,
			priority,
			rawLine: line,
			recurrence
		};
	}

	private parseDate(text: string): { date: Date | null } {
		// Formato Tasks plugin: 📅 2024-01-15 ou devido:: 2024-01-15
		const patterns = [
			/📅\s*(\d{4}-\d{2}-\d{2})/,           // Emoji de calendário
			/🗓️\s*(\d{4}-\d{2}-\d{2})/,          // Emoji alternativo
			/\[due::\s*(\d{4}-\d{2}-\d{2})\]/,   // Formato Dataview
			/due::\s*(\d{4}-\d{2}-\d{2})/,       // Dataview inline
			/@(\d{4}-\d{2}-\d{2})/,              // Formato @date
			/\((\d{4}-\d{2}-\d{2})\)/,           // Entre parênteses
			/scheduled::\s*(\d{4}-\d{2}-\d{2})/, // Scheduled
			/⏳\s*(\d{4}-\d{2}-\d{2})/,          // Emoji de ampulheta (scheduled)
		];

		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match) {
				const date = new Date(match[1] + "T00:00:00");
				if (!isNaN(date.getTime())) {
					return { date };
				}
			}
		}

		// Formato relativo: hoje, amanhã
		if (/\bhoje\b/i.test(text)) {
			return { date: new Date() };
		}
		if (/\bamanhã\b/i.test(text)) {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			return { date: tomorrow };
		}

		return { date: null };
	}

	private parseTime(text: string): { startTime: string | null; endTime: string | null; duration: number } {
		// Formatos suportados:
		// ⏰ 14:00
		// 🕐 14:00-15:30
		// [time:: 14:00]
		// (14:00 - 15:30)
		// 14h00
		// 14:00 às 15:30

		let startTime: string | null = null;
		let endTime: string | null = null;
		let duration = 60; // Padrão: 1 hora

		// Padrão com intervalo: 14:00-15:30 ou 14:00 - 15:30 ou 14:00 às 15:30
		const rangePatterns = [
			/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/,
			/(\d{1,2}):(\d{2})\s+às\s+(\d{1,2}):(\d{2})/i,
			/(\d{1,2})h(\d{2})?\s*[-–—]\s*(\d{1,2})h(\d{2})?/,
		];

		for (const pattern of rangePatterns) {
			const match = text.match(pattern);
			if (match) {
				const startHour = parseInt(match[1]);
				const startMin = parseInt(match[2] || "0");
				const endHour = parseInt(match[3]);
				const endMin = parseInt(match[4] || "0");

				startTime = `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;
				endTime = `${endHour.toString().padStart(2, "0")}:${endMin.toString().padStart(2, "0")}`;
				duration = (endHour * 60 + endMin) - (startHour * 60 + startMin);
				if (duration < 0) duration += 24 * 60;
				return { startTime, endTime, duration };
			}
		}

		// Padrão simples: apenas hora de início
		const simplePatterns = [
			/⏰\s*(\d{1,2}):(\d{2})/,
			/🕐\s*(\d{1,2}):(\d{2})/,
			/\[time::\s*(\d{1,2}):(\d{2})\]/,
			/(\d{1,2})h(\d{2})?(?!\d)/,
			/(?:^|\s)(\d{1,2}):(\d{2})(?!\d)/,
		];

		for (const pattern of simplePatterns) {
			const match = text.match(pattern);
			if (match) {
				const hour = parseInt(match[1]);
				const min = parseInt(match[2] || "0");
				startTime = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
				return { startTime, endTime, duration };
			}
		}

		return { startTime, endTime, duration };
	}

	private parsePriority(text: string): "high" | "medium" | "low" | "none" {
		if (/🔺|⏫|!!!/i.test(text) || /\[priority::\s*high\]/i.test(text)) return "high";
		if (/🔼|!!/i.test(text) || /\[priority::\s*medium\]/i.test(text)) return "medium";
		if (/🔽|!/i.test(text) || /\[priority::\s*low\]/i.test(text)) return "low";
		return "none";
	}

	private cleanTaskText(text: string): string {
		// Remove marcadores de data, hora, prioridade para exibição limpa
		return text
			.replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/🗓️\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/⏳\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/⏰\s*\d{1,2}:\d{2}/g, "")
			.replace(/🕐\s*\d{1,2}:\d{2}/g, "")
			.replace(/\[due::\s*\d{4}-\d{2}-\d{2}\]/g, "")
			.replace(/\[time::\s*\d{1,2}:\d{2}\]/g, "")
			.replace(/\[priority::\s*\w+\]/g, "")
			.replace(/due::\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/scheduled::\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/@\d{4}-\d{2}-\d{2}/g, "")
			.replace(/🔺|⏫|🔼|🔽/g, "")
			.replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/🔁\s*[^📅🗓️⏳⏰🕐🔺⏫🔼🔽✅]*/g, "")
			.replace(/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g, "")
			.replace(/\d{1,2}h\d{2}?\s*[-–—]\s*\d{1,2}h\d{2}?/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	private parseDoneDate(text: string): Date | null {
		const match = text.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
		if (!match) return null;
		const date = new Date(match[1] + "T00:00:00");
		return isNaN(date.getTime()) ? null : date;
	}

	private hasExplicitDate(line: string): boolean {
		const datePatterns = [
			/📅\s*\d{4}-\d{2}-\d{2}/,
			/🗓️\s*\d{4}-\d{2}-\d{2}/,
			/\[due::\s*\d{4}-\d{2}-\d{2}\]/,
			/due::\s*\d{4}-\d{2}-\d{2}/,
			/@\d{4}-\d{2}-\d{2}/,
			/\(\d{4}-\d{2}-\d{2}\)/,
			/scheduled::\s*\d{4}-\d{2}-\d{2}/,
			/⏳\s*\d{4}-\d{2}-\d{2}/,
		];
		return datePatterns.some(p => p.test(line));
	}

	private parseRecurrence(text: string): string | null {
		const match = text.match(/🔁\s*(.+?)(?=\s*[📅🗓️⏳⏰🕐🔺⏫🔼🔽✅]|$)/);
		if (!match) return null;
		return match[1].trim();
	}

	private calculateNextDate(currentDate: Date, recurrenceText: string, completionDate: Date): Date {
		const text = recurrenceText.toLowerCase().trim();
		const whenDone = text.includes("when done");
		const rule = text.replace(/when done/i, "").trim();
		const baseDate = whenDone ? new Date(completionDate) : new Date(currentDate);

		// every N days/weeks/months/years
		const nMatch = rule.match(/every\s+(\d+)\s+(day|week|month|year)s?/i);
		if (nMatch) {
			const n = parseInt(nMatch[1]);
			const unit = nMatch[2].toLowerCase();
			if (unit === "day") baseDate.setDate(baseDate.getDate() + n);
			else if (unit === "week") baseDate.setDate(baseDate.getDate() + n * 7);
			else if (unit === "month") baseDate.setMonth(baseDate.getMonth() + n);
			else if (unit === "year") baseDate.setFullYear(baseDate.getFullYear() + n);
			return baseDate;
		}

		// every day
		if (/every\s+day/i.test(rule)) {
			baseDate.setDate(baseDate.getDate() + 1);
			return baseDate;
		}

		// every week
		if (/every\s+week/i.test(rule)) {
			baseDate.setDate(baseDate.getDate() + 7);
			return baseDate;
		}

		// every month
		if (/every\s+month/i.test(rule)) {
			baseDate.setMonth(baseDate.getMonth() + 1);
			return baseDate;
		}

		// every year
		if (/every\s+year/i.test(rule)) {
			baseDate.setFullYear(baseDate.getFullYear() + 1);
			return baseDate;
		}

		// every weekday (seg-sex)
		if (/every\s+weekday/i.test(rule)) {
			do {
				baseDate.setDate(baseDate.getDate() + 1);
			} while (baseDate.getDay() === 0 || baseDate.getDay() === 6);
			return baseDate;
		}

		// every Monday/Tuesday/Wednesday/Thursday/Friday/Saturday/Sunday
		const dayNames: Record<string, number> = {
			sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
			thursday: 4, friday: 5, saturday: 6
		};
		const dayMatch = rule.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
		if (dayMatch) {
			const targetDay = dayNames[dayMatch[1].toLowerCase()];
			do {
				baseDate.setDate(baseDate.getDate() + 1);
			} while (baseDate.getDay() !== targetDay);
			return baseDate;
		}

		// Fallback: +1 dia
		baseDate.setDate(baseDate.getDate() + 1);
		return baseDate;
	}

	private formatDate(date: Date): string {
		const y = date.getFullYear();
		const m = (date.getMonth() + 1).toString().padStart(2, "0");
		const d = date.getDate().toString().padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	async toggleTaskCompletion(task: ParsedTask, tasksApi?: TasksApiV1 | null): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return false;

		// Tasks API v1: delega toggle completo (recurrence, done date, etc.)
		if (tasksApi) {
			try {
				const content = await this.app.vault.read(file);
				const lines = content.split("\n");
				const lineIndex = task.line - 1;
				if (lineIndex < 0 || lineIndex >= lines.length) return false;

				const originalLine = lines[lineIndex];
				const toggledLine = tasksApi.executeToggleTaskDoneCommand(originalLine, task.filePath);

				if (toggledLine && toggledLine !== originalLine) {
					lines[lineIndex] = toggledLine;
					await this.app.vault.modify(file, lines.join("\n"));
					task.completed = !task.completed;
					return true;
				}
			} catch (e) {
				console.warn("[BlockTime] Tasks API toggle falhou, usando fallback manual:", e);
			}
		}

		// Fallback manual
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const lineIndex = task.line - 1;

		if (lineIndex < 0 || lineIndex >= lines.length) return false;

		const line = lines[lineIndex];

		if (task.completed) {
			// DESCOMPLETAR: [x] → [ ] e remove ✅ done date
			const newLine = line
				.replace(/- \[[xX]\]/, "- [ ]")
				.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "");

			if (newLine === line) return false;
			lines[lineIndex] = newLine;
		} else {
			// COMPLETAR: [ ] → [x] + ✅ done date
			const todayStr = this.formatDate(new Date());
			let completedLine = line.replace(/- \[ \]/, "- [x]");
			if (!/✅/.test(completedLine)) {
				completedLine = completedLine.trimEnd() + ` ✅ ${todayStr}`;
			}

			if (completedLine === line) return false;

			// Se tem recorrência, cria próxima ocorrência ACIMA da completada
			if (task.recurrence) {
				let newTaskLine = line
					.replace(/- \[ \]/, "- [ ]")
					.replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "");

				if (this.hasExplicitDate(line) && task.date) {
					const nextDate = this.calculateNextDate(task.date, task.recurrence, new Date());
					const nextDateStr = this.formatDate(nextDate);

					newTaskLine = newTaskLine
						.replace(/(📅\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(🗓️\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(⏳\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(\[due::\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(due::\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(scheduled::\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(@)\d{4}-\d{2}-\d{2}/, `$1${nextDateStr}`)
						.replace(/(\()\d{4}-\d{2}-\d{2}(\))/, `$1${nextDateStr}$2`);
				}

				lines.splice(lineIndex, 1, newTaskLine, completedLine);
			} else {
				lines[lineIndex] = completedLine;
			}
		}

		await this.app.vault.modify(file, lines.join("\n"));
		task.completed = !task.completed;
		return true;
	}

	async editTaskLine(task: ParsedTask, tasksApi: TasksApiV1): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) return false;

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const lineIndex = task.line - 1;
		if (lineIndex < 0 || lineIndex >= lines.length) return false;

		const originalLine = lines[lineIndex];
		const editedLine = await tasksApi.editTaskLineModal(originalLine);

		if (editedLine && editedLine !== originalLine) {
			lines[lineIndex] = editedLine;
			await this.app.vault.modify(file, lines.join("\n"));
			return true;
		}
		return false;
	}

	isSameDay(date1: Date, date2: Date): boolean {
		return (
			date1.getFullYear() === date2.getFullYear() &&
			date1.getMonth() === date2.getMonth() &&
			date1.getDate() === date2.getDate()
		);
	}
}

// ============================================================================
// VIEW CUSTOMIZADA - Interface visual da agenda
// ============================================================================

class BlockTimeView extends ItemView {
	plugin: BlockTimeSchedulerPlugin;
	taskParser: TaskParser;
	currentDate: Date;
	viewMode: "day" | "week";
	private renderTimeout: ReturnType<typeof setTimeout> | null = null;
	private isToggling = false;
	private isRendering = false;
	private dayCheckInterval: ReturnType<typeof setInterval> | null = null;
	private lastKnownDay: string = "";
	private visibilityHandler: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: BlockTimeSchedulerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.taskParser = new TaskParser(this.app, plugin.settings, plugin.fileContentCache);
		this.currentDate = new Date();
		this.viewMode = plugin.settings.defaultView;
	}

	getViewType(): string {
		return VIEW_TYPE_BLOCK_TIME;
	}

	getDisplayText(): string {
		return "Block Time Scheduler";
	}

	getIcon(): string {
		return "calendar-clock";
	}

	async onOpen() {
		// Sempre inicia no dia atual ao abrir/reabrir
		this.currentDate = new Date();
		this.lastKnownDay = new Date().toDateString();
		await this.render();

		// Auto-refresh quando qualquer arquivo .md é modificado
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.isToggling) return;
				if (file instanceof TFile && file.extension === "md") {
					this.debouncedRender();
				}
			})
		);

		// Re-renderiza quando metadata cache atualiza (Tasks plugin modifica arquivos)
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (this.isToggling) return;
				if (file instanceof TFile && file.extension === "md") {
					this.debouncedRender();
				}
			})
		);

		// Verifica mudança de dia a cada 60s (cobre meia-noite)
		this.dayCheckInterval = setInterval(() => {
			this.checkDayChange();
		}, 60_000);

		// Verifica mudança de dia quando o Obsidian volta ao foco
		this.visibilityHandler = () => {
			if (document.visibilityState === "visible") {
				this.checkDayChange();
			}
		};
		document.addEventListener("visibilitychange", this.visibilityHandler);
	}

	async onClose() {
		if (this.renderTimeout) clearTimeout(this.renderTimeout);
		if (this.dayCheckInterval) clearInterval(this.dayCheckInterval);
		if (this.visibilityHandler) {
			document.removeEventListener("visibilitychange", this.visibilityHandler);
		}
		this.contentEl.empty();
	}

	private checkDayChange() {
		const today = new Date().toDateString();
		if (today !== this.lastKnownDay) {
			this.lastKnownDay = today;
			this.currentDate = new Date();
			console.debug("[BlockTime] Dia mudou, atualizando para", today);
			this.render();
		}
	}

	private debouncedRender() {
		if (this.renderTimeout) clearTimeout(this.renderTimeout);
		this.renderTimeout = setTimeout(() => {
			this.render();
		}, 800);
	}

	async render() {
		if (this.isRendering) return;
		this.isRendering = true;

		try {
		const container = this.contentEl;
		container.empty();
		container.addClass("block-time-container");

		if (this.plugin.settings.useObsidianTheme) {
			container.addClass("block-time-themed");
		} else {
			container.removeClass("block-time-themed");
		}

		// Header com controles
		this.renderHeader(container);

		// Grid de horas
		if (this.viewMode === "day") {
			await this.renderDayView(container);
		} else {
			await this.renderWeekView(container);
		}
		} finally {
			this.isRendering = false;
		}
	}

	private renderHeader(container: HTMLElement) {
		const header = container.createDiv({ cls: "block-time-header" });

		// Navegação de data
		const nav = header.createDiv({ cls: "block-time-nav" });

		const prevBtn = nav.createEl("button", { text: "◀", cls: "block-time-nav-btn" });
		prevBtn.addEventListener("click", () => this.navigateDate(-1));

		const dateDisplay = nav.createDiv({ cls: "block-time-date-display" });
		this.updateDateDisplay(dateDisplay);

		const nextBtn = nav.createEl("button", { text: "▶", cls: "block-time-nav-btn" });
		nextBtn.addEventListener("click", () => this.navigateDate(1));

		// Botão Hoje
		const todayBtn = nav.createEl("button", { text: "Hoje", cls: "block-time-today-btn" });
		todayBtn.addEventListener("click", () => {
			this.currentDate = new Date();
			this.render();
		});

		// Toggle de visualização
		const viewToggle = header.createDiv({ cls: "block-time-view-toggle" });
		
		const dayBtn = viewToggle.createEl("button", { 
			text: "Dia", 
			cls: `block-time-toggle-btn ${this.viewMode === "day" ? "active" : ""}`
		});
		dayBtn.addEventListener("click", () => {
			this.viewMode = "day";
			this.render();
		});

		const weekBtn = viewToggle.createEl("button", { 
			text: "Semana", 
			cls: `block-time-toggle-btn ${this.viewMode === "week" ? "active" : ""}`
		});
		weekBtn.addEventListener("click", () => {
			this.viewMode = "week";
			this.render();
		});

		// Botão Refresh
		const refreshBtn = header.createEl("button", { text: "🔄", cls: "block-time-refresh-btn" });
		refreshBtn.addEventListener("click", () => this.render());
	}

	private updateDateDisplay(element: HTMLElement) {
		const options: Intl.DateTimeFormatOptions = {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric"
		};

		if (this.viewMode === "week") {
			const startOfWeek = this.getStartOfWeek(this.currentDate);
			const endOfWeek = new Date(startOfWeek);
			endOfWeek.setDate(endOfWeek.getDate() + 6);

			element.textContent = `${startOfWeek.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} - ${endOfWeek.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}`;
		} else {
			element.textContent = this.currentDate.toLocaleDateString("pt-BR", options);
		}
	}

	private async renderDayView(container: HTMLElement) {
		const grid = container.createDiv({ cls: "block-time-grid day-view" });

		const { startHour, endHour } = this.plugin.settings;
		const tasks = await this.taskParser.getTasksForDate(this.currentDate);

		// Coluna de horas
		const hoursColumn = grid.createDiv({ cls: "block-time-hours-column" });
		for (let hour = startHour; hour <= endHour; hour++) {
			const hourSlot = hoursColumn.createDiv({ cls: "block-time-hour-label" });
			hourSlot.textContent = `${hour.toString().padStart(2, "0")}:00`;
		}

		// Coluna de tarefas
		const tasksColumn = grid.createDiv({ cls: "block-time-tasks-column" });

		// Slots de hora (vazios para referência visual + clique para criar task)
		for (let hour = startHour; hour <= endHour; hour++) {
			const hourSlot = tasksColumn.createDiv({ cls: "block-time-hour-slot" });
			hourSlot.dataset.hour = hour.toString();
			this.addSlotCreateHandler(hourSlot, hour, this.currentDate);
		}

		// Renderiza blocos de tarefas
		for (const task of tasks) {
			if (task.startTime) {
				this.renderTaskBlock(tasksColumn, task, startHour);
			}
		}

		// Lista de tarefas sem horário
		const unscheduledTasks = tasks.filter(t => !t.startTime);
		
		// Remove duplicatas de recorrências sem hora - mantém apenas uma instância por recorrência
		const uniqueUnscheduledTasks: ParsedTask[] = [];
		const seenRecurrenceKeys = new Set<string>();
		
		for (const task of unscheduledTasks) {
			if (task.recurrence) {
				// Usa texto base como chave para identificar recorrências
				const baseTaskText = task.rawLine.replace(/^(\s*)-\s*\[[xX]\]\s*/, "").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trim();
				const recurrenceKey = `${baseTaskText}_${task.filePath}`;
				
				if (!seenRecurrenceKeys.has(recurrenceKey)) {
					seenRecurrenceKeys.add(recurrenceKey);
					uniqueUnscheduledTasks.push(task);
				}
			} else {
				// Tasks não recorrentes sempre são adicionadas
				uniqueUnscheduledTasks.push(task);
			}
		}
		
		if (uniqueUnscheduledTasks.length > 0) {
			this.renderUnscheduledTasks(container, uniqueUnscheduledTasks);
		}
	}

	private async renderWeekView(container: HTMLElement) {
		const grid = container.createDiv({ cls: "block-time-grid week-view" });

		const { startHour, endHour } = this.plugin.settings;
		const startOfWeek = this.getStartOfWeek(this.currentDate);
		const tasks = await this.taskParser.getTasksForWeek(startOfWeek);

		// Cabeçalho dos dias
		const daysHeader = grid.createDiv({ cls: "block-time-days-header" });
		daysHeader.createDiv({ cls: "block-time-corner" }); // Canto vazio

		const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
		for (let d = 0; d < 7; d++) {
			const dayDate = new Date(startOfWeek);
			dayDate.setDate(dayDate.getDate() + d);
			const dayHeader = daysHeader.createDiv({ cls: "block-time-day-header" });
			dayHeader.createDiv({ cls: "day-name", text: dayNames[dayDate.getDay()] });
			dayHeader.createDiv({ cls: "day-number", text: dayDate.getDate().toString() });

			if (this.isToday(dayDate)) {
				dayHeader.addClass("today");
			}
		}

		// Grid de horas e dias
		const gridBody = grid.createDiv({ cls: "block-time-grid-body" });

		// Coluna de horas
		const hoursColumn = gridBody.createDiv({ cls: "block-time-hours-column" });
		for (let hour = startHour; hour <= endHour; hour++) {
			const hourSlot = hoursColumn.createDiv({ cls: "block-time-hour-label" });
			hourSlot.textContent = `${hour.toString().padStart(2, "0")}:00`;
		}

		// Colunas dos dias
		for (let d = 0; d < 7; d++) {
			const dayDate = new Date(startOfWeek);
			dayDate.setDate(dayDate.getDate() + d);

			const dayColumn = gridBody.createDiv({ cls: "block-time-day-column" });
			if (this.isToday(dayDate)) {
				dayColumn.addClass("today");
			}

			// Slots de hora
			for (let hour = startHour; hour <= endHour; hour++) {
				const hourSlot = dayColumn.createDiv({ cls: "block-time-hour-slot" });
				hourSlot.dataset.hour = hour.toString();
				hourSlot.dataset.day = d.toString();
				this.addSlotCreateHandler(hourSlot, hour, dayDate);
			}

			// Tarefas do dia
			const dayTasks = tasks.filter(t => t.date && this.isSameDay(t.date, dayDate));
			for (const task of dayTasks) {
				if (task.startTime) {
					this.renderTaskBlock(dayColumn, task, startHour);
				}
			}
		}

		// Lista de tarefas sem horário para toda a semana (apenas pendentes)
		const unscheduledTasks = tasks.filter(t => !t.startTime && !t.completed);
		
		// Remove duplicatas de recorrências sem hora - mantém apenas uma instância por recorrência
		const uniqueUnscheduledTasks: ParsedTask[] = [];
		const seenRecurrenceKeys = new Set<string>();
		
		for (const task of unscheduledTasks) {
			if (task.recurrence) {
				// Usa texto base como chave para identificar recorrências
				const baseTaskText = task.rawLine.replace(/^(\s*)-\s*\[[xX]\]\s*/, "").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "").trim();
				const recurrenceKey = `${baseTaskText}_${task.filePath}`;
				
				if (!seenRecurrenceKeys.has(recurrenceKey)) {
					seenRecurrenceKeys.add(recurrenceKey);
					uniqueUnscheduledTasks.push(task);
				}
			} else {
				// Tasks não recorrentes sempre são adicionadas
				uniqueUnscheduledTasks.push(task);
			}
		}
		
		if (uniqueUnscheduledTasks.length > 0) {
			this.renderUnscheduledTasks(container, uniqueUnscheduledTasks);
		}
	}

	private renderTaskBlock(container: HTMLElement, task: ParsedTask, startHour: number) {
		if (!task.startTime) return;

		const [hours, minutes] = task.startTime.split(":").map(Number);
		const topOffset = (hours - startHour) * 60 + minutes;
		const height = task.duration;

		const block = container.createDiv({ cls: "block-time-task-block" });
		block.style.top = `${topOffset}px`;
		block.style.height = `${Math.max(height, 30)}px`;

		// Classe de prioridade
		block.addClass(`priority-${task.priority}`);
		if (task.completed) {
			block.addClass("completed");
		}

		// Checkbox para concluir/desconcluir tarefa
		const checkbox = block.createEl("input", { type: "checkbox", cls: "block-time-task-checkbox" });
		checkbox.checked = task.completed;
		checkbox.addEventListener("click", async (e) => {
			e.stopPropagation();
			e.preventDefault();
			if (this.isToggling) return;
			this.isToggling = true;
			try {
				const api = this.plugin.getTasksApi();
				await this.taskParser.toggleTaskCompletion(task, api);
				await new Promise(resolve => setTimeout(resolve, 500));
				await this.render();
			} finally {
				this.isToggling = false;
			}
		});

		// Conteúdo do bloco
		const blockContent = block.createDiv({ cls: "block-time-task-content" });

		const timeLabel = blockContent.createDiv({ cls: "block-time-task-time" });
		timeLabel.textContent = task.endTime 
			? `${task.startTime} - ${task.endTime}`
			: task.startTime;

		const textLabel = blockContent.createDiv({ cls: "block-time-task-text" });
		textLabel.textContent = task.text || "Tarefa sem título";

		// Click simples → abrir arquivo
		blockContent.addEventListener("click", async () => {
			const file = this.app.vault.getAbstractFileByPath(task.filePath);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(file);
			}
		});

		// Duplo-clique → editar task via Tasks API (se disponível)
		blockContent.addEventListener("dblclick", async (e) => {
			e.stopPropagation();
			const api = this.plugin.getTasksApi();
			if (!api) {
				new Notice("Plugin Tasks não encontrado. Instale-o para editar tasks pelo calendário.");
				return;
			}
			const edited = await this.taskParser.editTaskLine(task, api);
			if (edited) {
				await new Promise(resolve => setTimeout(resolve, 500));
				await this.render();
			}
		});

		// Tooltip
		const apiHint = this.plugin.getTasksApi() ? " | Duplo-clique para editar" : "";
		block.setAttribute("title", `${task.text}\n📁 ${task.filePath}:${task.line}${apiHint}`);
	}

	private renderUnscheduledTasks(container: HTMLElement, tasks: ParsedTask[]) {
		const section = container.createDiv({ cls: "block-time-unscheduled" });
		section.createEl("h4", { text: "📋 Tarefas sem horário definido" });

		const list = section.createEl("ul", { cls: "block-time-unscheduled-list" });
		for (const task of tasks) {
			const item = list.createEl("li", { cls: `priority-${task.priority}` });
			if (task.completed) item.addClass("completed");

			const checkbox = item.createEl("input", { type: "checkbox" });
			checkbox.checked = task.completed;
			checkbox.addEventListener("click", async (e) => {
				e.stopPropagation();
				e.preventDefault();
				if (this.isToggling) return;
				this.isToggling = true;
				try {
					const api = this.plugin.getTasksApi();
					await this.taskParser.toggleTaskCompletion(task, api);
					await new Promise(resolve => setTimeout(resolve, 500));
					await this.render();
				} finally {
					this.isToggling = false;
				}
			});

			const textSpan = item.createSpan({ text: task.text || "Tarefa sem título" });
			// Click simples → abrir arquivo
			textSpan.addEventListener("click", async () => {
				const file = this.app.vault.getAbstractFileByPath(task.filePath);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(file);
				}
			});
			// Duplo-clique → editar via Tasks API
			textSpan.addEventListener("dblclick", async (e) => {
				e.stopPropagation();
				const api = this.plugin.getTasksApi();
				if (!api) return;
				const edited = await this.taskParser.editTaskLine(task, api);
				if (edited) {
					await new Promise(resolve => setTimeout(resolve, 500));
					await this.render();
				}
			});
		}
	}

	private addSlotCreateHandler(slot: HTMLElement, hour: number, date: Date) {
		const api = this.plugin.getTasksApi();
		if (!api) return;

		slot.addClass("block-time-slot-clickable");
		slot.setAttribute("title", "Clique para criar task neste horário");
		slot.addEventListener("click", async (e) => {
			if (e.target !== slot) return;

			const taskLine = await api.createTaskLineModal();
			if (!taskLine) return;

			// Determina o arquivo destino: daily note do dia clicado
			const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
			const dailyNotePath = this.getDailyNotePath(date);
			let file = this.app.vault.getAbstractFileByPath(dailyNotePath);

			// Cria o daily note se não existir
			if (!file) {
				try {
					file = await this.app.vault.create(dailyNotePath, `# ${dateStr}\n\n`);
				} catch {
					new Notice(`Não foi possível criar ${dailyNotePath}`);
					return;
				}
			}

			if (!(file instanceof TFile)) return;

			// Insere a task no final do arquivo
			const content = await this.app.vault.read(file);
			const hourStr = `${hour.toString().padStart(2, "0")}:00`;
			const lineToInsert = taskLine.includes(hourStr) ? taskLine : taskLine;
			const newContent = content.trimEnd() + "\n" + lineToInsert + "\n";
			await this.app.vault.modify(file, newContent);

			new Notice(`Task criada em ${dailyNotePath}`);
			await new Promise(resolve => setTimeout(resolve, 500));
			await this.render();
		});
	}

	private getDailyNotePath(date: Date): string {
		const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
		// Tenta detectar o formato de Daily Notes do Obsidian
		const dailyNotesPlugin = (this.app as any).internalPlugins?.plugins?.["daily-notes"]?.instance;
		const format = dailyNotesPlugin?.options?.format || "YYYY-MM-DD";
		const folder = dailyNotesPlugin?.options?.folder || "";

		const fileName = moment(date).format(format);
		return folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
	}

	private navigateDate(delta: number) {
		if (this.viewMode === "day") {
			this.currentDate.setDate(this.currentDate.getDate() + delta);
		} else {
			this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
		}
		this.render();
	}

	private getStartOfWeek(date: Date): Date {
		const d = new Date(date);
		const day = d.getDay();
		const diff = d.getDate() - day;
		return new Date(d.setDate(diff));
	}

	private isToday(date: Date): boolean {
		const today = new Date();
		return this.isSameDay(date, today);
	}

	private isSameDay(date1: Date, date2: Date): boolean {
		return (
			date1.getFullYear() === date2.getFullYear() &&
			date1.getMonth() === date2.getMonth() &&
			date1.getDate() === date2.getDate()
		);
	}
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

class BlockTimeSettingTab extends PluginSettingTab {
	plugin: BlockTimeSchedulerPlugin;

	constructor(app: App, plugin: BlockTimeSchedulerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ══════════════════════════════════════════════
		// SEÇÃO 1: AGENDA
		// ══════════════════════════════════════════════
		containerEl.createEl("h1", { text: "Block Time Scheduler" });
		containerEl.createEl("h2", { text: "📅 Agenda" });

		new Setting(containerEl)
			.setName("Hora de início")
			.setDesc("Primeira hora exibida na grade")
			.addSlider(slider => slider
				.setLimits(0, 12, 1)
				.setValue(this.plugin.settings.startHour)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.startHour = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Hora de término")
			.setDesc("Última hora exibida na grade")
			.addSlider(slider => slider
				.setLimits(18, 24, 1)
				.setValue(this.plugin.settings.endHour)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.endHour = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Visualização padrão")
			.setDesc("Escolha entre visualização diária ou semanal")
			.addDropdown(dropdown => dropdown
				.addOption("day", "Diária")
				.addOption("week", "Semanal")
				.setValue(this.plugin.settings.defaultView)
				.onChange(async (value: "day" | "week") => {
					this.plugin.settings.defaultView = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Pastas a escanear")
			.setDesc("Selecione as pastas onde buscar tarefas. Nenhuma selecionada = vault inteiro.");

		this.renderFolderPicker(containerEl);

		// Info box: integração Tasks API + criação de tasks
		const infoBox = containerEl.createDiv({ cls: "setting-item-description" });
		infoBox.style.marginTop = "8px";
		infoBox.style.padding = "10px 12px";
		infoBox.style.borderRadius = "6px";
		infoBox.style.backgroundColor = "var(--background-secondary)";
		infoBox.style.lineHeight = "1.6";
		infoBox.innerHTML = `
			<strong>Como funciona a criação e edição de tasks:</strong><br>
			<br>
			<strong>Clique em slot vazio</strong> na grade de horas — abre o modal do plugin <em>Tasks</em> para criar uma nova task. 
			A task é salva automaticamente no <strong>Daily Note</strong> do dia clicado, respeitando a pasta e formato configurados 
			no plugin <em>Daily Notes</em> do Obsidian (Configurações → Daily Notes).<br>
			<br>
			<strong>Duplo-clique em uma task</strong> — abre o modal do <em>Tasks</em> para editar a task existente (data, hora, recorrência, etc.). 
			As alterações são salvas diretamente no arquivo original.<br>
			<br>
			<strong>Checkbox</strong> — marca/desmarca a task. Se o plugin <em>Tasks</em> estiver instalado, usa a lógica dele 
			(recorrência automática, done date, etc.). Caso contrário, usa lógica manual interna.<br>
			<br>
			<em>Requer o plugin <strong>Tasks</strong> (<code>obsidian-tasks-plugin</code>) para criar e editar. 
			Sem ele, apenas o toggle por checkbox funciona.</em>
		`;

		// ══════════════════════════════════════════════
		// SEÇÃO 2: APARÊNCIA
		// ══════════════════════════════════════════════
		containerEl.createEl("h2", { text: "🎨 Aparência" });

		new Setting(containerEl)
			.setName("Usar tema do Obsidian")
			.setDesc("Herda as cores do tema ativo (incluindo temas baixados). Desative para usar as cores padrão do plugin.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useObsidianTheme)
				.onChange(async (value) => {
					this.plugin.settings.useObsidianTheme = value;
					await this.plugin.saveSettings();
					this.app.workspace.getLeavesOfType("block-time-view").forEach(leaf => {
						(leaf.view as BlockTimeView).render();
					});
				}));

		// ══════════════════════════════════════════════
		// SEÇÃO 3: NOTIFICAÇÕES DE HORÁRIO
		// ══════════════════════════════════════════════
		containerEl.createEl("h2", { text: "🔔 Notificações de Horário" });

		new Setting(containerEl)
			.setName("Ativar notificações")
			.setDesc("Notificação desktop e in-app quando uma tarefa com horário estiver prestes a começar.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNotifications)
				.onChange(async (value) => {
					this.plugin.settings.enableNotifications = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.startNotificationScheduler();
					} else {
						this.plugin.stopNotificationScheduler();
					}
				}));

		new Setting(containerEl)
			.setName("Lembrete antecipado")
			.setDesc("Notificação extra antes do horário da tarefa.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableReminderBefore)
				.onChange(async (value) => {
					this.plugin.settings.enableReminderBefore = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Minutos de antecedência")
			.setDesc("Quantos minutos antes do horário você quer ser lembrado.")
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.reminderMinutesBefore)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.reminderMinutesBefore = value;
					await this.plugin.saveSettings();
				}));

		// ══════════════════════════════════════════════
		// SEÇÃO 4: LEMBRETES DE PRAZO
		// ══════════════════════════════════════════════
		containerEl.createEl("h2", { text: "⚠️ Lembretes de Prazo" });

		new Setting(containerEl)
			.setName("Ativar lembretes de prazo")
			.setDesc("Notifica sobre tasks com tags de prazo próximas do vencimento.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDeadlineReminders)
				.onChange(async (value) => {
					this.plugin.settings.enableDeadlineReminders = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Tags de prazo")
			.setDesc("Tags que identificam tasks com prazo. Separadas por vírgula.")
			.addText(text => text
				.setPlaceholder("#prazo, #deadline")
				.setValue(this.plugin.settings.deadlineTags)
				.onChange(async (value) => {
					this.plugin.settings.deadlineTags = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Dias de antecedência")
			.setDesc("Quantos dias antes do prazo começar a notificar.")
			.addSlider(slider => slider
				.setLimits(1, 30, 1)
				.setValue(this.plugin.settings.deadlineReminderDays)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.deadlineReminderDays = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Hora do lembrete diário")
			.setDesc("A partir de que hora o lembrete de prazo dispara (uma vez por dia).")
			.addSlider(slider => slider
				.setLimits(6, 22, 1)
				.setValue(this.plugin.settings.deadlineReminderHour)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.deadlineReminderHour = value;
					await this.plugin.saveSettings();
				}));

		// ══════════════════════════════════════════════
		// SEÇÃO 5: PERSONALIZAR TEXTOS (collapsible)
		// ══════════════════════════════════════════════
		const detailsEl = containerEl.createEl("details", { cls: "block-time-settings-details" });
		detailsEl.createEl("summary", { text: "✏️ Personalizar textos das notificações" });

		const detailsContent = detailsEl.createDiv({ cls: "block-time-settings-details-content" });
		detailsContent.createEl("p", {
			text: "Placeholders: {task} {min} {days} {time} {endTime} {file} {date}",
			cls: "setting-item-description"
		});

		const templateSettings: { key: keyof BlockTimeSettings; name: string; desc: string }[] = [
			{ key: "notifyTextEarlyTask", name: "Lembrete antecipado", desc: "X min antes da tarefa" },
			{ key: "notifyTextOnTimeTask", name: "No horário", desc: "Momento exato da tarefa" },
			{ key: "notifyTextDeadlineEarly", name: "Prazo — min antes", desc: "X min antes do prazo" },
			{ key: "notifyTextDeadlineNow", name: "Prazo — agora", desc: "Horário exato do prazo" },
			{ key: "notifyTextDeadlineToday", name: "Prazo — hoje", desc: "Prazo é hoje (sem horário)" },
			{ key: "notifyTextDeadlineDays", name: "Prazo — dias", desc: "Faltam X dias para o prazo" },
		];

		for (const tmpl of templateSettings) {
			new Setting(detailsContent)
				.setName(tmpl.name)
				.setDesc(tmpl.desc)
				.addText(text => text
					.setValue(this.plugin.settings[tmpl.key] as string)
					.onChange(async (value) => {
						(this.plugin.settings[tmpl.key] as string) = value;
						await this.plugin.saveSettings();
					}));
		}
	}

	private renderFolderPicker(containerEl: HTMLElement) {
		const selectedFolders = this.plugin.settings.scanFolders
			.split(",")
			.map(f => f.trim().replace(/^\/+|\/+$/g, ""))
			.filter(f => f.length > 0);

		const pickerEl = containerEl.createDiv({ cls: "block-time-folder-picker" });

		// Tags das pastas selecionadas
		const tagsEl = pickerEl.createDiv({ cls: "block-time-folder-tags" });

		const renderTags = () => {
			tagsEl.empty();
			if (selectedFolders.length === 0) {
				tagsEl.createSpan({ text: "Nenhuma pasta selecionada (vault inteiro)", cls: "block-time-folder-hint" });
				return;
			}
			for (const folder of selectedFolders) {
				const tag = tagsEl.createSpan({ cls: "block-time-folder-tag" });
				tag.createSpan({ text: folder });
				const removeBtn = tag.createSpan({ text: " ✕", cls: "block-time-folder-tag-remove" });
				removeBtn.addEventListener("click", async () => {
					selectedFolders.splice(selectedFolders.indexOf(folder), 1);
					this.plugin.settings.scanFolders = selectedFolders.join(", ");
					await this.plugin.saveSettings();
					renderTags();
					renderTree();
				});
			}
		};

		renderTags();

		// Campo de busca
		const searchContainer = pickerEl.createDiv({ cls: "block-time-folder-search" });
		const searchInput = searchContainer.createEl("input", {
			type: "text",
			placeholder: "Buscar pasta...",
			cls: "block-time-folder-search-input"
		});

		// Árvore de pastas
		const treeEl = pickerEl.createDiv({ cls: "block-time-folder-tree" });
		treeEl.style.display = "none";

		// Estado de colapso (inicia tudo colapsado)
		const expandedSet: Set<string> = new Set();

		interface FolderNode {
			name: string;
			path: string;
			children: FolderNode[];
		}

		const buildTree = (): FolderNode[] => {
			const root: FolderNode[] = [];
			const recurse = (parent: TFolder): FolderNode[] => {
				const nodes: FolderNode[] = [];
				const sorted = [...parent.children].sort((a, b) => a.name.localeCompare(b.name));
				for (const child of sorted) {
					if (child instanceof TFolder && !child.path.startsWith(".")) {
						nodes.push({
							name: child.name,
							path: child.path,
							children: recurse(child)
						});
					}
				}
				return nodes;
			};
			return recurse(this.app.vault.getRoot());
		};

		const matchesFilter = (node: FolderNode, filter: string): boolean => {
			if (node.path.toLowerCase().includes(filter)) return true;
			return node.children.some(c => matchesFilter(c, filter));
		};

		const renderTree = (filter?: string) => {
			treeEl.empty();
			const tree = buildTree();
			const lowerFilter = (filter || "").toLowerCase();

			const renderNodes = (nodes: FolderNode[], depth: number) => {
				for (const node of nodes) {
					if (lowerFilter && !matchesFilter(node, lowerFilter)) continue;

					const hasChildren = node.children.length > 0;
					const isExpanded = lowerFilter ? true : expandedSet.has(node.path);
					const isSelected = selectedFolders.includes(node.path);

					const row = treeEl.createDiv({ cls: `block-time-folder-row ${isSelected ? "is-selected" : ""}` });
					row.style.paddingLeft = `${8 + depth * 20}px`;

					// Seta de colapso
					const arrow = row.createSpan({ cls: "block-time-folder-arrow" });
					if (hasChildren) {
						arrow.textContent = isExpanded ? "▼" : "▶";
						arrow.addClass("has-children");
						arrow.addEventListener("click", (e) => {
							e.stopPropagation();
							if (expandedSet.has(node.path)) {
								expandedSet.delete(node.path);
							} else {
								expandedSet.add(node.path);
							}
							renderTree(filter);
						});
					}

					// Checkbox real
					const cb = row.createEl("input", { type: "checkbox", cls: "block-time-folder-cb" });
					cb.checked = isSelected;
					cb.addEventListener("click", async (e) => {
						e.stopPropagation();
						if (isSelected) {
							selectedFolders.splice(selectedFolders.indexOf(node.path), 1);
						} else {
							selectedFolders.push(node.path);
						}
						this.plugin.settings.scanFolders = selectedFolders.join(", ");
						await this.plugin.saveSettings();
						renderTags();
						renderTree(filter);
					});

					// Nome da pasta
					const label = row.createSpan({ text: node.name, cls: "block-time-folder-label" });
					label.addEventListener("click", async () => {
						if (isSelected) {
							selectedFolders.splice(selectedFolders.indexOf(node.path), 1);
						} else {
							selectedFolders.push(node.path);
						}
						this.plugin.settings.scanFolders = selectedFolders.join(", ");
						await this.plugin.saveSettings();
						renderTags();
						renderTree(filter);
					});

					// Renderiza filhos se expandido
					if (hasChildren && isExpanded) {
						renderNodes(node.children, depth + 1);
					}
				}
			};

			renderNodes(tree, 0);
		};

		searchInput.addEventListener("focus", () => {
			treeEl.style.display = "block";
			renderTree(searchInput.value);
		});

		searchInput.addEventListener("input", () => {
			renderTree(searchInput.value);
		});

		document.addEventListener("click", (e) => {
			if (!pickerEl.contains(e.target as Node)) {
				treeEl.style.display = "none";
			}
		});
	}
}
