export type Locale = "en" | "ru";
export type ThemeMode = "dark" | "light";

const ru: Record<string, string> = {
  "Workspace": "Рабочая область",
  "Zones": "Зоны",
  "Zone detail": "Зона",
  "Backends": "Бэкенды",
  "Audit": "Аудит",
  "Users & grants": "Пользователи и доступ",
  "Backend config": "Конфиг бэкендов",
  "Identity providers": "Провайдеры входа",
  "Sign out": "Выйти",
  "Zone": "Зона",
  "Theme": "Тема",
  "Language": "Язык",
  "Dark": "Тёмная",
  "Light": "Светлая",
  "Close": "Закрыть",
  "Cancel": "Отмена",
  "Frontend shell": "Фронтенд-оболочка",
  "Username": "Логин",
  "Password": "Пароль",
  "Sign in": "Войти",
  "Signing in…": "Вход…",
  "Redirecting…": "Переход…",
  "OIDC": "OIDC",
  "API status": "Статус API",
  "Inventory sync": "Синхронизация inventory",
  "CSRF": "CSRF",
  "enabled": "включено",
  "disabled": "выключено",
  "checking": "проверка",
  "pending": "ожидание",
  "Zone inventory": "Инвентарь зон",
  "Total visible zones": "Всего видимых зон",
  "Writable workspaces": "Рабочие пространства с записью",
  "Backends in scope": "Бэкенды в контуре",
  "Current focus": "Текущий фокус",
  "Pick a zone": "Выберите зону",
  "Search zones": "Поиск зон",
  "Filter by zone or backend": "Фильтр по зоне или бэкенду",
  "Operator scope": "Операторский контур",
  "Inventory": "Инвентарь",
  "Loading zones": "Загрузка зон",
  "Zone inventory is unavailable": "Инвентарь зон недоступен",
  "Clear search": "Сбросить поиск",
  "No zones match this search": "Нет зон по этому поиску",
  "No zones are available": "Нет доступных зон",
  "managed zone": "управляемая зона",
  "Open now": "Открыта",
  "Available": "Доступна",
  "read-only session": "сессия только для чтения",
  "write path enabled": "запись доступна",
  "read-only backend": "бэкенд только для чтения",
  "Open zone detail for records, diff previews, and permission-aware actions.": "Откройте зону для записей, diff-превью и действий с учётом прав.",
  "Open zone workspace": "Открыть рабочую область зоны",
  "Active now": "Активна",
  "View records": "Показать записи",
  "Loading zone detail": "Загрузка зоны",
  "Zone detail is unavailable": "Зона недоступна",
  "Search records": "Поиск записей",
  "read-only": "только чтение",
  "Add record": "Добавить запись",
  "Sync backend": "Синхронизировать бэкенд",
  "Syncing…": "Синхронизация…",
  "Backend": "Бэкенд",
  "Visible records": "Видимых записей",
  "Access": "Доступ",
  "Capabilities": "Возможности",
  "Records": "Записи",
  "Record table": "Таблица записей",
  "Search by name, type, ttl, or value…": "Поиск по имени, типу, TTL или значению…",
  "All types": "Все типы",
  "rows": "строк",
  "Name": "Имя",
  "Type": "Тип",
  "Select": "Выбрать",
  "Value": "Значение",
  "Actions": "Действия",
  "Edit": "Изменить",
  "Delete": "Удалить",
  "Previous": "Назад",
  "Next": "Дальше",
  "Read-only": "Только чтение",
  "Clear filters": "Сбросить фильтры",
  "No records are present": "Записей пока нет",
  "No records match the current filters": "Нет записей по текущим фильтрам",
  "Backend inventory": "Инвентарь бэкендов",
  "Visible backends": "Видимых бэкендов",
  "Managed zones": "Управляемых зон",
  "Write-capable": "С поддержкой записи",
  "Discovery-enabled": "С обнаружением",
  "Loading backends": "Загрузка бэкендов",
  "Backend inventory is unavailable": "Инвентарь бэкендов недоступен",
  "No backends are registered": "Бэкенды не зарегистрированы",
  "Record access": "Доступ к записям",
  "Discovery": "Обнаружение",
  "Manual": "Ручной",
  "Operator UX": "Операторский UX",
  "Inventory + sync": "Инвентарь + синхронизация",
  "Inventory only": "Только инвентарь",
  "Sync zones": "Синхронизировать зоны",
  "Manual registration": "Ручная регистрация",
  "Audit log": "Журнал аудита",
  "Search audit events": "Поиск событий аудита",
  "Filter audit by actor": "Фильтр по актору",
  "Filter audit by zone": "Фильтр по зоне",
  "All actors": "Все акторы",
  "All zones": "Все зоны",
  "Actor": "Актор",
  "Zone label": "Зона",
  "Backend label": "Бэкенд",
  "Payload": "Данные",
  "Loading audit events": "Загрузка событий аудита",
  "Audit listing failed": "Не удалось загрузить аудит",
  "Audit history is empty": "Журнал аудита пуст",
  "No audit events match the current filters": "По текущим фильтрам нет событий аудита",
  "Showing the latest 250 events for this session.": "Показаны последние 250 событий для этой сессии.",
  "Filter who did what, when, and against which zone or backend without dropping to SQL.": "Фильтруйте, кто что сделал, когда и с какой зоной или бэкендом это было связано, без перехода к SQL.",
  "Fetching the latest operator actions and shaping the feed for this session.": "Загружаем последние действия операторов и собираем ленту для этой сессии.",
  "The backend rejected the audit query for this session.": "Бэкенд отклонил запрос аудита для этой сессии.",
  "Operator actions will appear here once sessions start authenticating and mutating zones.": "Операторские действия появятся здесь, как только сессии начнут входить в систему и менять зоны.",
  "Widen the search or clear the actor and zone filters to inspect more history.": "Расширьте поиск или очистите фильтры по актору и зоне, чтобы увидеть больше истории.",
  "Users, roles, and zone grants": "Пользователи, роли и права на зоны",
  "Admin only": "Только для админа",
  "Users": "Пользователи",
  "Directory": "Каталог",
  "Manage": "Управление",
  "Selected user": "Выбранный пользователь",
  "Access workflow": "Сценарий доступа",
  "Config": "Конфиг",
  "Backend registry": "Реестр бэкендов",
  "Discovery-ready": "Готовы к обнаружению",
  "Discover and import zones": "Найти и импортировать зоны",
  "Guardrails": "Правила",
  "Operator rules": "Операторские правила",
  "Identity": "Идентификация",
  "Provider workspace": "Рабочая область провайдера",
  "Providers": "Провайдеры",
  "Provider details": "Параметры провайдера",
  "Loading identity providers…": "Загрузка провайдеров…",
  "No identity providers have been configured yet.": "Провайдеры входа ещё не настроены.",
  "New provider": "Новый провайдер",
  "Reset form": "Сбросить форму",
  "Issuer": "Адрес issuer",
  "Client ID": "Идентификатор клиента",
  "Client secret": "Секрет клиента",
  "Scopes": "Области доступа",
  "Claims mapping rules JSON": "Правила маппинга claims (JSON)",
  "Delete provider": "Удалить провайдер",
  "Role bindings": "Привязки ролей",
  "Current session selected": "Выбрана текущая сессия",
  "Zone grants not needed": "Права на зоны не нужны",
  "Global role": "Глобальная роль",
  "Baseline permissions": "Базовые права",
  "applies everywhere": "действует везде",
  "User": "Пользователь",
  "Save global role": "Сохранить глобальную роль",
  "Zone grant": "Права на зону",
  "Scoped overrides": "Точечные переопределения",
  "only when needed": "только при необходимости",
  "Grant zone": "Зона для прав",
  "No zones available": "Нет доступных зон",
  "Save zone grant": "Сохранить права на зону",
  "Loading grants…": "Загрузка прав…",
  "Record form": "Форма записи",
  "Record type": "Тип записи",
  "Type-specific fields": "Поля для типа",
  "Text values": "Текстовые значения",
  "IPv4 addresses": "IPv4-адреса",
  "IPv6 addresses": "IPv6-адреса",
  "Target hostname": "Целевой hostname",
  "Mail exchangers": "Почтовые обменники",
  "Add MX value": "Добавить MX",
  "Change preview": "Предпросмотр изменений",
  "Diff preview": "Diff-превью",
  "Operation": "Операция",
  "Summary": "Итог",
  "Before": "До",
  "After": "После",
  "Conflict detected": "Обнаружен конфликт",
  "discoverZones": "Обнаружение",
  "readZones": "Метаданные зоны",
  "readRecords": "Чтение записей",
  "writeRecords": "Запись записей",
  "commentsMetadata": "Комментарии",
  "importSnapshot": "Импорт snapshot",
  "rfc2136Update": "Обновление RFC2136",
};

const en: Record<string, string> = {};

export function tr(locale: Locale, key: string) {
  if (locale === "ru") {
    return ru[key] ?? key;
  }
  return en[key] ?? key;
}

export function roleLabel(locale: Locale, role: string | null | undefined) {
  if (!role) {
    return "";
  }
  if (locale === "ru") {
    return (
      {
        admin: "админ",
        editor: "редактор",
        viewer: "наблюдатель",
      }[role] ?? role
    );
  }
  return role;
}

export function boolLabel(locale: Locale, value: boolean) {
  return tr(locale, value ? "enabled" : "disabled");
}

export function pluralize(locale: Locale, count: number, forms: {
  en: [string, string];
  ru: [string, string, string];
}) {
  if (locale === "ru") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return forms.ru[0];
    }
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
      return forms.ru[1];
    }
    return forms.ru[2];
  }
  return count === 1 ? forms.en[0] : forms.en[1];
}

export function countLabel(
  locale: Locale,
  count: number,
  forms: { en: [string, string]; ru: [string, string, string] },
) {
  return `${count} ${pluralize(locale, count, forms)}`;
}
