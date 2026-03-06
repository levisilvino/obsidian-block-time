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
	moment,
	AbstractInputSuggest
} from "obsidian";

// ============================================================================
// INTERFACES E TIPOS
// ============================================================================

interface FolderNode {
	name: string;
	path: string;
	children: FolderNode[];
}

class FolderSuggest extends AbstractInputSuggest<string> {
	private folders: Set<string>;

	constructor(
		app: App, 
		inputEl: HTMLInputElement, 
		folders: Set<string>
	) {
		super(app, inputEl);
		this.folders = folders;
	}

	getSuggestions(query: string): string[] {
		const lowerCaseQuery = query.toLowerCase();
		return [...this.folders].filter(folder => 
			folder.toLowerCase().includes(lowerCaseQuery)
		);
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.setText(folder);
	}

	selectSuggestion(folder: string, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(folder);
		this.close();
	}
}

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
// INTERNACIONALIZAÇÃO
// ============================================================================

interface Translations {
	[key: string]: {
		[key: string]: string;
	};
}

const TRANSLATIONS: Translations = {
	'en': {
		'view-title': 'Block Time Scheduler',
		'day-view': 'Day View',
		'week-view': 'Week View',
		'today': 'Today',
		'unscheduled-tasks': 'Unscheduled Tasks',
		'no-tasks': 'No tasks scheduled',
		'create-task': 'Create task',
		'hours': 'Hours',
		'priority-high': 'High',
		'priority-medium': 'Medium', 
		'priority-low': 'Low',
		'task-completed': 'Task completed',
		'task-uncompleted': 'Task uncompleted',
		// Dias da semana
		'sunday': 'Sun',
		'monday': 'Mon',
		'tuesday': 'Tue',
		'wednesday': 'Wed',
		'thursday': 'Thu',
		'friday': 'Fri',
		'saturday': 'Sat',
		// Configurações
		'settings-agenda': 'Agenda',
		'settings-appearance': 'Appearance',
		'settings-notifications': 'Notifications',
		'settings-deadlines': 'Deadlines',
		'settings-texts': 'Texts',
		'start-hour': 'Start hour',
		'start-hour-desc': 'Hour when the agenda starts',
		'end-hour': 'End hour',
		'end-hour-desc': 'Hour when the agenda ends',
		'default-view': 'Default view',
		'default-view-desc': 'Default view when opening the agenda',
		'use-obsidian-theme': 'Use Obsidian theme',
		'use-obsidian-theme-desc': 'Use colors from your current Obsidian theme',
		'enable-notifications': 'Enable notifications',
		'enable-notifications-desc': 'Show desktop notifications for tasks',
		'notification-early': 'Early reminder',
		'notification-early-desc': 'X minutes before task',
		'notification-ontime': 'On time',
		'notification-ontime-desc': 'Exact moment of task',
		'notification-deadline-early': 'Deadline — minutes before',
		'notification-deadline-early-desc': 'X minutes before deadline',
		'notification-deadline-now': 'Deadline — now',
		'notification-deadline-now-desc': 'Exact deadline time',
		'notification-deadline-today': 'Deadline — today',
		'notification-deadline-today-desc': 'Deadline is today (no time)',
		'notification-deadline-days': 'Deadline — days',
		'notification-deadline-days-desc': 'X days until deadline',
		'scan-folders': 'Scan folders',
		'scan-folders-desc': 'Folders to scan for tasks (comma separated)',
		'no-folders-selected': 'No folders selected (entire vault)',
		'placeholders': 'Placeholders: {task} {min} {days} {time} {endTime} {file} {date}',
		'advanced-folder-mode': 'Advanced folder selection mode',
		'advanced-folder-mode-desc': 'Use advanced folder picker with tree view (disable for simple text mode)'
	},
	'pt': {
		'view-title': 'Agenda de Blocos de Tempo',
		'day-view': 'Visão Diária',
		'week-view': 'Visão Semanal',
		'today': 'Hoje',
		'unscheduled-tasks': 'Tarefas sem horário definido',
		'no-tasks': 'Nenhuma tarefa agendada',
		'create-task': 'Criar tarefa',
		'hours': 'Horas',
		'priority-high': 'Alta',
		'priority-medium': 'Média',
		'priority-low': 'Baixa',
		'task-completed': 'Tarefa concluída',
		'task-uncompleted': 'Tarefa não concluída',
		// Dias da semana
		'sunday': 'Dom',
		'monday': 'Seg',
		'tuesday': 'Ter',
		'wednesday': 'Qua',
		'thursday': 'Qui',
		'friday': 'Sex',
		'saturday': 'Sáb',
		// Configurações
		'settings-agenda': 'Agenda',
		'settings-appearance': 'Aparência',
		'settings-notifications': 'Notificações',
		'settings-deadlines': 'Prazos',
		'settings-texts': 'Textos',
		'start-hour': 'Hora inicial',
		'start-hour-desc': 'Hora quando a agenda começa',
		'end-hour': 'Hora final',
		'end-hour-desc': 'Hora quando a agenda termina',
		'default-view': 'Visão padrão',
		'default-view-desc': 'Visão padrão ao abrir a agenda',
		'use-obsidian-theme': 'Usar tema do Obsidian',
		'use-obsidian-theme-desc': 'Usar cores do seu tema atual do Obsidian',
		'enable-notifications': 'Ativar notificações',
		'enable-notifications-desc': 'Mostrar notificações na área de trabalho para tarefas',
		'notification-early': 'Lembrete antecipado',
		'notification-early-desc': 'X minutos antes da tarefa',
		'notification-ontime': 'No horário',
		'notification-ontime-desc': 'Momento exato da tarefa',
		'notification-deadline-early': 'Prazo — minutos antes',
		'notification-deadline-early-desc': 'X minutos antes do prazo',
		'notification-deadline-now': 'Prazo — agora',
		'notification-deadline-now-desc': 'Horário exato do prazo',
		'notification-deadline-today': 'Prazo — hoje',
		'notification-deadline-today-desc': 'Prazo é hoje (sem horário)',
		'notification-deadline-days': 'Prazo — dias',
		'notification-deadline-days-desc': 'Faltam X dias para o prazo',
		'scan-folders': 'Pastas para escanear',
		'scan-folders-desc': 'Pastas para procurar tarefas (separadas por vírgula)',
		'no-folders-selected': 'Nenhuma pasta selecionada (vault inteiro)',
		'placeholders': 'Placeholders: {task} {min} {days} {time} {endTime} {file} {date}',
		'advanced-folder-mode': 'Modo avançado de seleção de pastas',
		'advanced-folder-mode-desc': 'Use o seletor avançado com árvore de pastas (desative para modo simples com texto)'
	},
	'es': {
		'view-title': 'Agenda de Bloques de Tiempo',
		'day-view': 'Vista Diaria',
		'week-view': 'Vista Semanal',
		'today': 'Hoy',
		'unscheduled-tasks': 'Tareas sin horario definido',
		'no-tasks': 'No hay tareas programadas',
		'create-task': 'Crear tarea',
		'hours': 'Horas',
		'priority-high': 'Alta',
		'priority-medium': 'Media',
		'priority-low': 'Baja',
		'task-completed': 'Tarea completada',
		'task-uncompleted': 'Tarea no completada',
		// Dias da semana
		'sunday': 'Dom',
		'monday': 'Lun',
		'tuesday': 'Mar',
		'wednesday': 'Mié',
		'thursday': 'Jue',
		'friday': 'Vie',
		'saturday': 'Sáb',
		// Configurações
		'settings-agenda': 'Agenda',
		'settings-appearance': 'Apariencia',
		'settings-notifications': 'Notificaciones',
		'settings-deadlines': 'Plazos',
		'settings-texts': 'Textos',
		'start-hour': 'Hora de inicio',
		'start-hour-desc': 'Hora cuando la agenda comienza',
		'end-hour': 'Hora final',
		'end-hour-desc': 'Hora cuando la agenda termina',
		'default-view': 'Vista predeterminada',
		'default-view-desc': 'Vista predeterminada al abrir la agenda',
		'use-obsidian-theme': 'Usar tema de Obsidian',
		'use-obsidian-theme-desc': 'Usar colores de tu tema actual de Obsidian',
		'enable-notifications': 'Activar notificaciones',
		'enable-notifications-desc': 'Mostrar notificaciones de escritorio para tareas',
		'notification-early': 'Recordatorio temprano',
		'notification-early-desc': 'X minutos antes de la tarea',
		'notification-ontime': 'A tiempo',
		'notification-ontime-desc': 'Momento exacto de la tarea',
		'notification-deadline-early': 'Plazo — minutos antes',
		'notification-deadline-early-desc': 'X minutos antes del plazo',
		'notification-deadline-now': 'Plazo — ahora',
		'notification-deadline-now-desc': 'Hora exacta del plazo',
		'notification-deadline-today': 'Plazo — hoy',
		'notification-deadline-today-desc': 'El plazo es hoy (sin hora)',
		'notification-deadline-days': 'Plazo — días',
		'notification-deadline-days-desc': 'Faltan X días para el plazo',
		'scan-folders': 'Carpetas para escanear',
		'scan-folders-desc': 'Carpetas para buscar tareas (separadas por coma)',
		'no-folders-selected': 'Ninguna carpeta seleccionada (vault entero)',
		'placeholders': 'Placeholders: {task} {min} {days} {time} {endTime} {file} {date}',
		'advanced-folder-mode': 'Modo avanzado de selección de carpetas',
		'advanced-folder-mode-desc': 'Use el selector avanzado con árbol de carpetas (desactive para modo simple con texto)'
	},
	'fr': {
		'view-title': 'Planificateur de Blocs de Temps',
		'day-view': 'Vue Journalière',
		'week-view': 'Vue Hebdomadaire',
		'today': 'Aujourd\'hui',
		'unscheduled-tasks': 'Tâches sans horaire défini',
		'no-tasks': 'Aucune tâche programmée',
		'create-task': 'Créer une tâche',
		'hours': 'Heures',
		'priority-high': 'Haute',
		'priority-medium': 'Moyenne',
		'priority-low': 'Basse',
		'task-completed': 'Tâche terminée',
		'task-uncompleted': 'Tâche non terminée',
		// Dias da semana
		'sunday': 'Dim',
		'monday': 'Lun',
		'tuesday': 'Mar',
		'wednesday': 'Mer',
		'thursday': 'Jeu',
		'friday': 'Ven',
		'saturday': 'Sam',
		// Configurações
		'settings-agenda': 'Agenda',
		'settings-appearance': 'Apparence',
		'settings-notifications': 'Notifications',
		'settings-deadlines': 'Échéances',
		'settings-texts': 'Textes',
		'start-hour': 'Heure de début',
		'start-hour-desc': 'Heure quand l\'agenda commence',
		'end-hour': 'Heure de fin',
		'end-hour-desc': 'Heure quand l\'agenda se termine',
		'default-view': 'Vue par défaut',
		'default-view-desc': 'Vue par défaut à l\'ouverture de l\'agenda',
		'use-obsidian-theme': 'Utiliser le thème Obsidian',
		'use-obsidian-theme-desc': 'Utiliser les couleurs de votre thème Obsidian actuel',
		'enable-notifications': 'Activer les notifications',
		'enable-notifications-desc': 'Afficher les notifications de bureau pour les tâches',
		'notification-early': 'Rappel anticipé',
		'notification-early-desc': 'X minutes avant la tâche',
		'notification-ontime': 'À l\'heure',
		'notification-ontime-desc': 'Moment exact de la tâche',
		'notification-deadline-early': 'Échéance — minutes avant',
		'notification-deadline-early-desc': 'X minutes avant l\'échéance',
		'notification-deadline-now': 'Échéance — maintenant',
		'notification-deadline-now-desc': 'Heure exacte de l\'échéance',
		'notification-deadline-today': 'Échéance — aujourd\'hui',
		'notification-deadline-today-desc': 'L\'échéance est aujourd\'hui (sans heure)',
		'notification-deadline-days': 'Échéance — jours',
		'notification-deadline-days-desc': 'X jours jusqu\'à l\'échéance',
		'scan-folders': 'Dossiers à scanner',
		'scan-folders-desc': 'Dossiers pour chercher les tâches (séparés par virgule)',
		'no-folders-selected': 'Aucun dossier sélectionné (vault entier)',
		'placeholders': 'Placeholders: {task} {min} {days} {time} {endTime} {file} {date}',
		'advanced-folder-mode': 'Mode avancé de sélection de dossiers',
		'advanced-folder-mode-desc': 'Utilisez le sélecteur avancé avec arborescence (désactivez pour mode simple avec texte)'
	},
	'de': {
		'view-title': 'Block-Zeitplaner',
		'day-view': 'Tagesansicht',
		'week-view': 'Wochenansicht',
		'today': 'Heute',
		'unscheduled-tasks': 'Aufgaben ohne definierte Uhrzeit',
		'no-tasks': 'Keine Aufgaben geplant',
		'create-task': 'Aufgabe erstellen',
		'hours': 'Stunden',
		'priority-high': 'Hoch',
		'priority-medium': 'Mittel',
		'priority-low': 'Niedrig',
		'task-completed': 'Aufgabe erledigt',
		'task-uncompleted': 'Aufgabe nicht erledigt',
		// Dias da semana
		'sunday': 'So',
		'monday': 'Mo',
		'tuesday': 'Di',
		'wednesday': 'Mi',
		'thursday': 'Do',
		'friday': 'Fr',
		'saturday': 'Sa',
		// Configurações
		'settings-agenda': 'Agenda',
		'settings-appearance': 'Erscheinungsbild',
		'settings-notifications': 'Benachrichtigungen',
		'settings-deadlines': 'Fristen',
		'settings-texts': 'Texte',
		'start-hour': 'Startzeit',
		'start-hour-desc': 'Stunde wann die Agenda beginnt',
		'end-hour': 'Endzeit',
		'end-hour-desc': 'Stunde wann die Agenda endet',
		'default-view': 'Standardansicht',
		'default-view-desc': 'Standardansicht beim Öffnen der Agenda',
		'use-obsidian-theme': 'Obsidian-Theme verwenden',
		'use-obsidian-theme-desc': 'Farben Ihres aktuellen Obsidian-Themes verwenden',
		'enable-notifications': 'Benachrichtigungen aktivieren',
		'enable-notifications-desc': 'Desktop-Benachrichtigungen für Aufgaben anzeigen',
		'notification-early': 'Frühe Erinnerung',
		'notification-early-desc': 'X Minuten vor der Aufgabe',
		'notification-ontime': 'Pünktlich',
		'notification-ontime-desc': 'Exakter Zeitpunkt der Aufgabe',
		'notification-deadline-early': 'Frist — Minuten vorher',
		'notification-deadline-early-desc': 'X Minuten vor der Frist',
		'notification-deadline-now': 'Frist — jetzt',
		'notification-deadline-now-desc': 'Exakte Fristzeit',
		'notification-deadline-today': 'Frist — heute',
		'notification-deadline-today-desc': 'Frist ist heute (keine Zeit)',
		'notification-deadline-days': 'Frist — Tage',
		'notification-deadline-days-desc': 'X Tage bis zur Frist',
		'scan-folders': 'Ordner scannen',
		'scan-folders-desc': 'Ordner für Aufgaben (Komma getrennt)',
		'no-folders-selected': 'Keine Ordner ausgewählt (ganzer Vault)',
		'placeholders': 'Placeholders: {task} {min} {days} {time} {endTime} {file} {date}',
		'advanced-folder-mode': 'Erweiterter Ordnerauswahlmodus',
		'advanced-folder-mode-desc': 'Verwenden Sie erweiterten Ordnerauswahl mit Baumansicht (deaktivieren für einfachen Textmodus)'
	},
	'it': {
		'view-title': 'Programmatore di Blocchi di Tempo',
		'day-view': 'Vista Giornaliera',
		'week-view': 'Vista Settimanale',
		'today': 'Oggi',
		'unscheduled-tasks': 'Attività senza orario definito',
		'no-tasks': 'Nessuna attività programmata',
		'create-task': 'Crea attività',
		'hours': 'Ore',
		'priority-high': 'Alta',
		'priority-medium': 'Media',
		'priority-low': 'Bassa',
		'task-completed': 'Attività completata',
		'task-uncompleted': 'Attività non completata',
		// Dias da semana
		'sunday': 'Dom',
		'monday': 'Lun',
		'tuesday': 'Mar',
		'wednesday': 'Mer',
		'thursday': 'Gio',
		'friday': 'Ven',
		'saturday': 'Sab'
	},
	'ja': {
		'view-title': 'ブロックタイムスケジューラー',
		'day-view': '日表示',
		'week-view': '週表示',
		'today': '今日',
		'unscheduled-tasks': '時間未定のタスク',
		'no-tasks': 'スケジュールされたタスクはありません',
		'create-task': 'タスク作成',
		'hours': '時間',
		'priority-high': '高',
		'priority-medium': '中',
		'priority-low': '低',
		'task-completed': 'タスク完了',
		'task-uncompleted': 'タスク未完了',
		// Dias da semana
		'sunday': '日',
		'monday': '月',
		'tuesday': '火',
		'wednesday': '水',
		'thursday': '木',
		'friday': '金',
		'saturday': '土'
	},
	'zh': {
		'view-title': '时间块调度器',
		'day-view': '日视图',
		'week-view': '周视图',
		'today': '今天',
		'unscheduled-tasks': '未定义时间的任务',
		'no-tasks': '没有安排的任务',
		'create-task': '创建任务',
		'hours': '小时',
		'priority-high': '高',
		'priority-medium': '中',
		'priority-low': '低',
		'task-completed': '任务已完成',
		'task-uncompleted': '任务未完成',
		// Dias da semana
		'sunday': '周日',
		'monday': '周一',
		'tuesday': '周二',
		'wednesday': '周三',
		'thursday': '周四',
		'friday': '周五',
		'saturday': '周六'
	},
	'ru': {
		'view-title': 'Планировщик временных блоков',
		'day-view': 'Дневной вид',
		'week-view': 'Недельный вид',
		'today': 'Сегодня',
		'unscheduled-tasks': 'Задачи без определенного времени',
		'no-tasks': 'Нет запланированных задач',
		'create-task': 'Создать задачу',
		'hours': 'Часы',
		'priority-high': 'Высокий',
		'priority-medium': 'Средний',
		'priority-low': 'Низкий',
		'task-completed': 'Задача выполнена',
		'task-uncompleted': 'Задача не выполнена',
		// Dias da semana
		'sunday': 'Вс',
		'monday': 'Пн',
		'tuesday': 'Вт',
		'wednesday': 'Ср',
		'thursday': 'Чт',
		'friday': 'Пт',
		'saturday': 'Сб'
	}
};

class I18n {
	private locale: string;
	private translations: Translations;

	constructor(moment: any) {
		// Detecta idioma do Obsidian
		this.locale = moment.locale() || 'en';
		
		// Mapeamento de idiomas do moment para nossos códigos
		const localeMap: Record<string, string> = {
			'pt-br': 'pt',
			'pt': 'pt',
			'es': 'es',
			'fr': 'fr',
			'de': 'de',
			'it': 'it',
			'ja': 'ja',
			'zh-cn': 'zh',
			'zh': 'zh',
			'ru': 'ru'
		};

		this.locale = localeMap[this.locale.toLowerCase()] || 'en';
		this.translations = TRANSLATIONS;
	}

	t(key: string): string {
		return this.translations[this.locale]?.[key] || this.translations['en'][key] || key;
	}

	getLocale(): string {
		return this.locale;
	}
}

// ============================================================================
// CONSTANTES
// ============================================================================

const PLUGIN_VERSION = "1.0.0";
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
	i18n: I18n;
	settingTab: BlockTimeSettingTab | null = null; // Referência para invalidação de cache

	async onload() {
		await this.loadSettings();

		// Inicializa internacionalização
		this.i18n = new I18n(window.moment);

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
		this.settingTab = new BlockTimeSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Eventos para invalidar cache de pastas quando arquivos são modificados
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (this.settingTab) {
				this.settingTab.invalidateFolderCache();
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (this.settingTab) {
				this.settingTab.invalidateFolderCache();
			}
		}));

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.settingTab) {
				this.settingTab.invalidateFolderCache();
			}
		}));

		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (this.settingTab) {
				this.settingTab.invalidateFolderCache();
			}
		}));

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

		console.log(`Block Time Scheduler v${PLUGIN_VERSION} carregado!`);
	}

	onunload() {
		this.stopNotificationScheduler();
		this.fileContentCache.clear();
		console.log(`Block Time Scheduler v${PLUGIN_VERSION} descarregado!`);
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

	private calculateImplicitStartDate(recurrence: string, currentDate: Date): Date {
		const rule = recurrence.toLowerCase().trim();
		
		// Every week on specific day (formato Tasks simples)
		const simpleWeekOnMatch = rule.match(/every\s+week\s+on\s+(.+)/i);
		if (simpleWeekOnMatch) {
			const dayText = simpleWeekOnMatch[1].toLowerCase().trim();
			const dayNames: Record<string, number> = {
				sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
				thursday: 4, friday: 5, saturday: 6
			};
			
			const targetDay = dayNames[dayText];
			if (targetDay !== undefined) {
				const result = new Date(currentDate);
				const currentDay = result.getDay();
				const daysUntilTarget = (targetDay - currentDay + 7) % 7;
				result.setDate(result.getDate() + daysUntilTarget);
				return result;
			}
		}
		
		// Every weekday (seg-sex)
		if (/every\s+weekday/i.test(rule)) {
			const result = new Date(currentDate);
			const currentDay = result.getDay();
			if (currentDay === 0) { // Domingo
				result.setDate(result.getDate() + 1); // Próxima Segunda
			} else if (currentDay === 6) { // Sábado
				result.setDate(result.getDate() + 2); // Próxima Segunda
			}
			return result;
		}
		
		// Para outros casos, usa data atual
		return new Date(currentDate);
	}

	private shouldRecurOnDate(task: ParsedTask, targetDate: Date): boolean {
		if (!task.recurrence) return false;
		const recurrenceRule = task.recurrence.toLowerCase().trim();
		
		// Data de início da recorrência
		let startDate = task.date;
		if (!startDate) {
			// Se não tem data, calcula data implícita baseada na recorrência
			startDate = this.calculateImplicitStartDate(task.recurrence, new Date());
		}

		// Não aparece antes da data de início
		if (targetDate < startDate) return false;

		// Every day
		if (/every\s+day/i.test(recurrenceRule)) return true;
		
		// Every weekday (seg-sex)
		if (/every\s+weekday/i.test(recurrenceRule)) {
			const dayOfWeek = targetDate.getDay();
			return dayOfWeek >= 1 && dayOfWeek <= 5;
		}

		// Every week on specific day (formato Tasks)
		const weekOnMatch = recurrenceRule.match(/every\s+(\d+)\s+weeks?\s+on\s+(.+)/i);
		if (weekOnMatch) {
			const daysText = weekOnMatch[2].toLowerCase();
			const days = daysText.split(',').map(d => d.trim().replace(/,$/, ''));
			
			const dayNames: Record<string, number> = {
				sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
				thursday: 4, friday: 5, saturday: 6
			};
			
			const targetDayOfWeek = targetDate.getDay();
			return days.some(day => {
				const dayNum = dayNames[day];
				return dayNum !== undefined && dayNum === targetDayOfWeek;
			});
		}

		// Every week on specific day (formato Tasks simples)
		const simpleWeekOnMatch = recurrenceRule.match(/every\s+week\s+on\s+(.+)/i);
		if (simpleWeekOnMatch) {
			const dayText = simpleWeekOnMatch[1].toLowerCase().trim();
			const dayNames: Record<string, number> = {
				sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
				thursday: 4, friday: 5, saturday: 6
			};
			
			const targetDayOfWeek = targetDate.getDay();
			const dayNum = dayNames[dayText];
			return dayNum !== undefined && dayNum === targetDayOfWeek;
		}

		// Every week (genérico) - não captura "every week on"
		if (/every\s+week$/i.test(recurrenceRule)) {
			return startDate.getDay() === targetDate.getDay();
		}

		// Every month on specific day (formato Tasks)
		const monthOnMatch = recurrenceRule.match(/every\s+month\s+on\s+the\s+(\d+)(?:st|nd|rd|th)/i);
		if (monthOnMatch) {
			const targetDay = parseInt(monthOnMatch[1]);
			return targetDate.getDate() === targetDay;
		}

		// Every N months on specific day (formato Tasks)
		const nMonthOnMatch = recurrenceRule.match(/every\s+(\d+)\s+months?\s+on\s+the\s+(\d+)(?:st|nd|rd|th)/i);
		if (nMonthOnMatch) {
			const n = parseInt(nMonthOnMatch[1]);
			const targetDay = parseInt(nMonthOnMatch[2]);
			const monthsDiff = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + 
							(targetDate.getMonth() - startDate.getMonth());
			return monthsDiff >= 0 && monthsDiff % n === 0 && targetDate.getDate() === targetDay;
		}

		// Every N months on specific weekday (formato Tasks)
		const nMonthWeekdayMatch = recurrenceRule.match(/every\s+(\d+)\s+months?\s+on\s+the\s+(\d+)(?:st|nd|rd|th)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
		if (nMonthWeekdayMatch) {
			const n = parseInt(nMonthWeekdayMatch[1]);
			const weekNum = parseInt(nMonthWeekdayMatch[2]);
			const weekday = nMonthWeekdayMatch[3].toLowerCase();
			
			const dayNames: Record<string, number> = {
				sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
				thursday: 4, friday: 5, saturday: 6
			};
			
			const targetWeekday = dayNames[weekday];
			const firstDayOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
			const firstWeekday = firstDayOfMonth.getDay();
			const offset = (targetWeekday - firstWeekday + 7) % 7;
			const targetDateOfMonth = 1 + offset + (weekNum - 1) * 7;
			
			if (targetDateOfMonth > new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate()) {
				return false; // Dia não existe neste mês
			}
			
			const monthsDiff = (targetDate.getFullYear() - startDate.getFullYear()) * 12 + 
							(targetDate.getMonth() - startDate.getMonth());
			return monthsDiff >= 0 && monthsDiff % n === 0 && targetDate.getDate() === targetDateOfMonth;
		}

		// Every specific month on specific day (formato Tasks)
		const specificMonthMatch = recurrenceRule.match(/every\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+on\s+the\s+(\d+)(?:st|nd|rd|th)/i);
		if (specificMonthMatch) {
			const monthName = specificMonthMatch[1].toLowerCase();
			const targetDay = parseInt(specificMonthMatch[2]);
			const monthNames: Record<string, number> = {
				january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
				july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
			};
			return targetDate.getMonth() === monthNames[monthName] && targetDate.getDate() === targetDay;
		}

		// Every specific months on specific days (formato Tasks)
		const specificMonthsMatch = recurrenceRule.match(/every\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+and\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+on\s+the\s+(\d+)(?:st|nd|rd|th)\s+and\s+the\s+(\d+)(?:st|nd|rd|th)/i);
		if (specificMonthsMatch) {
			const month1Name = specificMonthsMatch[1].toLowerCase();
			const month2Name = specificMonthsMatch[2].toLowerCase();
			const targetDay1 = parseInt(specificMonthsMatch[3]);
			const targetDay2 = parseInt(specificMonthsMatch[4]);
			
			const monthNames: Record<string, number> = {
				january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
				july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
			};
			
			const currentMonth = targetDate.getMonth();
			const currentDay = targetDate.getDate();
			
			return (currentMonth === monthNames[month1Name] && currentDay === targetDay1) ||
				   (currentMonth === monthNames[month2Name] && currentDay === targetDay2);
		}

		// Every month (genérico)
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

		// every week (genérico) - não captura "every week on"
		if (/every\s+week$/i.test(rule)) {
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

		// every week on specific day (formato Tasks)
		const weekOnMatch = rule.match(/every\s+(\d+)\s+weeks?\s+on\s+(.+)/i);
		if (weekOnMatch) {
			const n = parseInt(weekOnMatch[1]);
			baseDate.setDate(baseDate.getDate() + (7 * n));
			return baseDate;
		}

		// every week on specific day (formato Tasks simples)
		const simpleWeekOnMatch = rule.match(/every\s+week\s+on\s+(.+)/i);
		if (simpleWeekOnMatch) {
			baseDate.setDate(baseDate.getDate() + 7);
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

		// Fallback manual (só se Tasks API não estiver disponível)
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
		return this.plugin.i18n.t('view-title');
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

		// Seção esquerda: Navegação de data
		const nav = header.createDiv({ cls: "block-time-nav" });

		const prevBtn = nav.createEl("button", { text: "◀", cls: "block-time-nav-btn" });
		prevBtn.addEventListener("click", () => this.navigateDate(-1));

		const dateDisplay = nav.createDiv({ cls: "block-time-date-display" });
		this.updateDateDisplay(dateDisplay);

		const nextBtn = nav.createEl("button", { text: "▶", cls: "block-time-nav-btn" });
		nextBtn.addEventListener("click", () => this.navigateDate(1));

		// Botão Hoje
		const todayBtn = nav.createEl("button", { text: this.plugin.i18n.t('today'), cls: "block-time-today-btn" });
		todayBtn.addEventListener("click", () => {
			this.currentDate = new Date();
			this.render();
		});

		// Seção direita: Toggle de visualização e refresh
		const controls = header.createDiv({ cls: "block-time-controls" });

		// Toggle de visualização
		const viewToggle = controls.createDiv({ cls: "block-time-view-toggle" });
		
		const dayBtn = viewToggle.createEl("button", { 
			text: this.plugin.i18n.t('day-view'), 
			cls: `block-time-toggle-btn ${this.viewMode === "day" ? "active" : ""}` 
		});
		dayBtn.addEventListener("click", () => {
			this.viewMode = "day";
			this.render();
		});

		const weekBtn = viewToggle.createEl("button", { 
			text: this.plugin.i18n.t('week-view'), 
			cls: `block-time-toggle-btn ${this.viewMode === "week" ? "active" : ""}` 
		});
		weekBtn.addEventListener("click", () => {
			this.viewMode = "week";
			this.render();
		});

		// Botão Refresh
		const refreshBtn = controls.createEl("button", { text: "🔄", cls: "block-time-refresh-btn" });
		refreshBtn.addEventListener("click", () => this.render());
	}

	private updateDateDisplay(element: HTMLElement) {
		const dayNames = [
			this.plugin.i18n.t('sunday'),
			this.plugin.i18n.t('monday'),
			this.plugin.i18n.t('tuesday'),
			this.plugin.i18n.t('wednesday'),
			this.plugin.i18n.t('thursday'),
			this.plugin.i18n.t('friday'),
			this.plugin.i18n.t('saturday')
		];
		
		const dayName = dayNames[this.currentDate.getDay()];
		const date = this.currentDate.getDate();
		const month = this.currentDate.toLocaleDateString(this.plugin.i18n.getLocale(), { month: 'long' });
		const year = this.currentDate.getFullYear();
		
		element.textContent = `${dayName}, ${date} de ${month} de ${year}`;
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

		const dayNames = [
			this.plugin.i18n.t('sunday'),
			this.plugin.i18n.t('monday'),
			this.plugin.i18n.t('tuesday'),
			this.plugin.i18n.t('wednesday'),
			this.plugin.i18n.t('thursday'),
			this.plugin.i18n.t('friday'),
			this.plugin.i18n.t('saturday')
		];
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
		section.createEl("h4", { text: this.plugin.i18n.t('unscheduled-tasks') });

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

	// Cache para evitar reescaneamento desnecessário
	private folderCache: {
		folders: Set<string>;
		timestamp: number;
		fileCount: number;
	} | null = null;

	private folderTreeCache: {
		tree: FolderNode[];
		timestamp: number;
		fileCount: number;
	} | null = null;

	private readonly CACHE_DURATION = 30000; // 30 segundos

	constructor(app: App, plugin: BlockTimeSchedulerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// ============================================================================
	// MÉTODOS UTILITÁRIOS
	// ============================================================================

	private getAllFolders(): Set<string> {
		const now = Date.now();
		
		// Verificar se cache é válido (apenas por tempo)
		if (this.folderCache && 
			this.folderCache.folders.size > 0 &&
			(now - this.folderCache.timestamp) < this.CACHE_DURATION) {
			
			return this.folderCache.folders;
		}

		// Cache inválido ou não existe - recalcular
		const startTime = performance.now();
		
		const folders = new Set<string>();
		const files = this.app.vault.getFiles();
		
		for (const file of files) {
			const parts = file.path.split("/");
			let currentPath = "";
			
			for (const part of parts) {
				if (part === file.name) continue; // Ignora o nome do arquivo
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				folders.add(currentPath);
			}
		}

		// Atualizar cache
		this.folderCache = {
			folders,
			timestamp: now,
			fileCount: files.length // Mantido para logging, não usado na validação
		};

		const endTime = performance.now();
		
		return folders;
	}

	public invalidateFolderCache(): void {
		if (this.folderCache || this.folderTreeCache) {
			this.folderCache = null;
			this.folderTreeCache = null;
		}
	}

	private buildFolderTree(files: TFile[]): FolderNode[] {
		const now = Date.now();
		
		// Verificar se cache é válido (apenas por tempo)
		if (this.folderTreeCache && 
			this.folderTreeCache.tree.length > 0 &&
			(now - this.folderTreeCache.timestamp) < this.CACHE_DURATION) {
			
			return this.folderTreeCache.tree;
		}

		// Cache inválido ou não existe - recalcular
		const startTime = performance.now();
		
		const nodeMap = new Map<string, FolderNode>();

		// Inicializa todos os nós
		for (const file of files) {
			const parts = file.path.split("/");
			let currentPath = "";
			
			for (const part of parts) {
				if (part === file.name) continue; // Ignora o nome do arquivo
				
				const parentPath = currentPath;
				currentPath = parentPath ? `${parentPath}/${part}` : part;

				if (!nodeMap.has(currentPath)) {
					nodeMap.set(currentPath, {
						name: part,
						path: currentPath,
						children: []
					});
				}

				// Adiciona como filho do pai
				if (parentPath && nodeMap.has(parentPath)) {
					const parentNode = nodeMap.get(parentPath)!;
					const currentNode = nodeMap.get(currentPath)!;
					if (!parentNode.children.includes(currentNode)) {
						parentNode.children.push(currentNode);
					}
				}
			}
		}

		// Retorna apenas os nós raiz
		const tree = Array.from(nodeMap.values()).filter(node => !node.path.includes("/"));

		// Atualizar cache
		this.folderTreeCache = {
			tree,
			timestamp: now,
			fileCount: files.length // Mantido para logging, não usado na validação
		};

		const endTime = performance.now();

		return tree;
	}

	private parseSelectedFolders(): string[] {
		return this.plugin.settings.scanFolders
			.split(",")
			.map(f => f.trim().replace(/^\/+|\/+$/g, ""))
			.filter(f => f.length > 0);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ══════════════════════════════════════════════
		// SEÇÃO 1: AGENDA
		// ══════════════════════════════════════════════
		containerEl.createEl("h1", { text: this.plugin.i18n.t('view-title') });
		containerEl.createEl("h2", { text: this.plugin.i18n.t('settings-agenda') });

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('start-hour'))
			.setDesc(this.plugin.i18n.t('start-hour-desc'))
			.addSlider(slider => slider
				.setLimits(0, 12, 1)
				.setValue(this.plugin.settings.startHour)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.startHour = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.i18n.t('end-hour'))
			.setDesc(this.plugin.i18n.t('end-hour-desc'))
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
		containerEl.createEl("h2", { text: this.plugin.i18n.t('settings-appearance') });

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
		// SEÇÃO 3: NOTIFICAÇÕES
		// ══════════════════════════════════════════════
		containerEl.createEl("h2", { text: this.plugin.i18n.t('settings-notifications') });

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
		// SEÇÃO 4: PRAZOS
		// ══════════════════════════════════════════════
		containerEl.createEl("h2", { text: this.plugin.i18n.t('settings-deadlines') });

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
		// SEÇÃO 5: TEXTOS
		// ══════════════════════════════════════════════
		const detailsEl = containerEl.createEl("details", { cls: "block-time-settings-details" });
		detailsEl.createEl("summary", { text: this.plugin.i18n.t('settings-texts') });

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
		// Toggle para escolher entre simples e avançado
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('advanced-folder-mode'))
			.setDesc(this.plugin.i18n.t('advanced-folder-mode-desc'))
			.addToggle(toggle => toggle
				.setValue(false) // Default: modo simples
				.onChange(async (value) => {
					// Re-renderiza com o modo selecionado
					this.renderFolderPickerWithMode(pickerContainer, value);
				}));

		// Container para o seletor escolhido
		const pickerContainer = containerEl.createDiv({ cls: "block-time-folder-picker-container" });
		this.renderFolderPickerWithMode(pickerContainer, false); // Inicia com modo simples
	}

	private renderFolderPickerWithMode(containerEl: HTMLElement, advancedMode: boolean) {
		// Limpa apenas o container do seletor, não o container principal
		containerEl.empty();

		if (advancedMode) {
			// Modo avançado (antigo implementação)
			this.renderAdvancedFolderPicker(containerEl);
		} else {
			// Modo simples (padrão Obsidian)
			this.renderSimpleFolderPicker(containerEl);
		}
	}

	private renderSimpleFolderPicker(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('scan-folders'))
			.setDesc(this.plugin.i18n.t('scan-folders-desc'))
			.addText(text => {
				// Usa o método utilitário da classe
				const folders = this.getAllFolders();
				const folderSuggest = new FolderSuggest(this.app, text.inputEl, folders);
				
				// Registra callback para quando uma pasta for selecionada
				folderSuggest.onSelect((folder: string, evt: MouseEvent | KeyboardEvent) => {
					const currentValue = text.getValue();
					const foldersList = currentValue.split(",").map(f => f.trim()).filter(f => f);
					
					if (!foldersList.includes(folder)) {
						foldersList.push(folder);
						text.setValue(foldersList.join(", "));
					}
				});
				
				return text
					.setPlaceholder("Exemplo: pasta1, pasta2/subpasta")
					.setValue(this.plugin.settings.scanFolders)
					.onChange(async (value) => {
						this.plugin.settings.scanFolders = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderAdvancedFolderPicker(containerEl: HTMLElement) {
		const selectedFolders = this.parseSelectedFolders();

		const pickerEl = containerEl.createDiv({ cls: "block-time-folder-picker" });

		// Tags das pastas selecionadas
		const tagsEl = pickerEl.createDiv({ cls: "block-time-folder-tags" });

		const renderTags = () => {
			tagsEl.empty();
			if (selectedFolders.length === 0) {
				tagsEl.createSpan({ text: this.plugin.i18n.t('no-folders-selected'), cls: "block-time-folder-hint" });
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
		treeEl.style.display = "block"; // Mostra imediatamente no modo avançado

		// Estado de colapso (inicia tudo colapsado)
		const expandedSet: Set<string> = new Set();

		const renderNode = (node: FolderNode, depth: number = 0, filterQuery: string = "") => {
			// Filtra pela busca se houver
			if (filterQuery && !node.name.toLowerCase().includes(filterQuery.toLowerCase())) {
				return;
			}

			const rowEl = treeEl.createDiv({ cls: "block-time-folder-row" });
			rowEl.style.paddingLeft = `${depth * 16}px`;

			// Checkbox
			const cb = rowEl.createEl("input", { type: "checkbox", cls: "block-time-folder-cb" });
			cb.checked = selectedFolders.includes(node.path);
			cb.addEventListener("change", async () => {
				if (cb.checked) {
					if (!selectedFolders.includes(node.path)) {
						selectedFolders.push(node.path);
					}
				} else {
					const index = selectedFolders.indexOf(node.path);
					if (index > -1) {
						selectedFolders.splice(index, 1);
					}
				}
				this.plugin.settings.scanFolders = selectedFolders.join(", ");
				await this.plugin.saveSettings();
				renderTags();
			});

			// Setas para expandir/colapsar
			if (node.children.length > 0) {
				const arrow = rowEl.createSpan({ cls: "block-time-folder-arrow has-children" });
				arrow.textContent = expandedSet.has(node.path) ? "▼" : "▶";
				arrow.addEventListener("click", (e) => {
					e.stopPropagation();
					if (expandedSet.has(node.path)) {
						expandedSet.delete(node.path);
					} else {
						expandedSet.add(node.path);
					}
					renderTree();
				});
			}

			// Nome da pasta
			const label = rowEl.createSpan({ cls: "block-time-folder-label" });
			label.textContent = node.name;
			rowEl.addEventListener("click", () => {
				cb.checked = !cb.checked;
				cb.dispatchEvent(new Event("change"));
			});

			// Renderiza filhos se expandido
			if (node.children.length > 0 && expandedSet.has(node.path)) {
				for (const child of node.children) {
					renderNode(child, depth + 1, filterQuery);
				}
			}
		};

		const renderTree = (filterQuery: string = "") => {
			treeEl.empty();
			const allFiles = this.app.vault.getFiles();
			const folderTree = this.buildFolderTree(allFiles);

			for (const node of folderTree) {
				renderNode(node, 0, filterQuery);
			}
		};

		// Busca
		searchInput.addEventListener("input", () => {
			const query = searchInput.value.toLowerCase().trim();
			// Sempre mostra a árvore no modo avançado, busca filtra os resultados
			treeEl.style.display = "block";
			renderTree(query);
		});

		// Foca no campo ao clicar no picker
		pickerEl.addEventListener("click", () => {
			searchInput.focus();
			treeEl.style.display = "block";
			renderTree(searchInput.value);
		});

		// Fecha ao clicar fora
		document.addEventListener("click", (e) => {
			if (!pickerEl.contains(e.target as Node)) {
				treeEl.style.display = "none";
			}
		});

		renderTree();
	}
}
