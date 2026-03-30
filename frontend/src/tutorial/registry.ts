import type { Locale } from "../uiText";
import type { TutorialChapter, TutorialCopy } from "./types";

function copy(
  en: TutorialCopy,
  ru: TutorialCopy,
): Record<Locale, TutorialCopy> {
  return { en, ru };
}

function chapterCopy(enLabel: string, enDescription: string, ruLabel: string, ruDescription: string) {
  return {
    en: { label: enLabel, description: enDescription },
    ru: { label: ruLabel, description: ruDescription },
  };
}

export const tutorialUiCopy = {
  en: {
    launcher: "Learn the workspace",
    hubTitle: "Tutorials",
    hubBody:
      "Resume the main onboarding or replay a chapter for the screen you need right now.",
    continue: "Continue tutorial",
    restart: "Restart onboarding",
    replay: "Replay chapter",
    current: "Current",
    completed: "Completed",
    available: "Available",
    locked: "Admin only",
    close: "Close",
    chapterListTitle: "Chapter library",
    progressChapter: "Chapter progress",
    progressOverall: "Overall progress",
    skipForNow: "Skip for now",
    neverShowAgain: "Never show again",
    back: "Back",
    next: "Next",
    finish: "Finish",
    targetMissingTitle: "This step adapted to the current screen",
    targetMissingBody:
      "The highlighted element is unavailable right now, so the tutorial kept the explanation and let you continue without blocking the workspace.",
  },
  ru: {
    launcher: "Изучить рабочую область",
    hubTitle: "Обучение",
    hubBody:
      "Продолжайте основной onboarding или переигрывайте отдельную главу для нужного экрана.",
    continue: "Продолжить tutorial",
    restart: "Перезапустить onboarding",
    replay: "Повторить главу",
    current: "Текущая",
    completed: "Завершена",
    available: "Доступна",
    locked: "Только для админа",
    close: "Закрыть",
    chapterListTitle: "Библиотека глав",
    progressChapter: "Прогресс главы",
    progressOverall: "Общий прогресс",
    skipForNow: "Пропустить пока",
    neverShowAgain: "Больше не показывать",
    back: "Назад",
    next: "Дальше",
    finish: "Завершить",
    targetMissingTitle: "Этот шаг адаптирован к текущему экрану",
    targetMissingBody:
      "Нужный элемент сейчас недоступен, поэтому tutorial сохранил объяснение и дал продолжить без блокировки рабочей области.",
  },
} as const;

export const tutorialRegistry: TutorialChapter[] = [
  {
    id: "welcome-shell",
    kind: "core",
    routeKinds: ["zones", "zone", "backends", "audit", "admin-access", "admin-backends", "admin-identity"],
    copy: chapterCopy(
      "Welcome",
      "Understand the shell, the operator scope, and how to move safely.",
      "Добро пожаловать",
      "Поймите оболочку, операторский контур и безопасную навигацию.",
    ),
    isEligible: (context) => context.isAuthenticated,
    steps: [
      {
        id: "welcome-intro",
        type: "modal",
        copy: copy(
          {
            title: "Welcome to Zonix",
            body:
              "This workspace explains the control plane in the same sequence operators actually use it: orient first, act second, verify last.",
            note: "You can stop now, disable auto-start forever, or reopen any chapter later from the shell header.",
            primaryLabel: "Start walkthrough",
          },
          {
            title: "Добро пожаловать в Zonix",
            body:
              "Эта рабочая область объясняет control plane в том же порядке, в котором реально работают операторы: сначала ориентир, потом действие, потом проверка.",
            note: "Можно остановиться сейчас, навсегда отключить автостарт или позже вернуть любую главу из заголовка shell.",
            primaryLabel: "Начать walkthrough",
          },
        ),
        canSkip: true,
        canDismissForever: true,
      },
      {
        id: "shell-nav",
        type: "coachmark",
        targetId: "shell-nav-zones",
        placement: "right",
        copy: copy(
          {
            title: "Navigation is split by operator tasks",
            body:
              "The sidebar keeps inventory, audits, and admin workspaces separate so operators can move without mixing read paths, write paths, and privileged setup.",
            note: "The active route stays visible and chapter progress follows you across pages.",
            primaryLabel: "Continue",
          },
          {
            title: "Навигация разделена по задачам оператора",
            body:
              "Сайдбар разводит инвентарь, аудит и админские рабочие области, чтобы оператор не смешивал чтение, запись и привилегированные настройки.",
            note: "Активный маршрут остаётся видимым, а прогресс главы следует за вами между страницами.",
            primaryLabel: "Продолжить",
          },
        ),
        fallbackCopy: copy(
          {
            title: "Navigation stays consistent across the shell",
            body:
              "Every major workflow has a dedicated route, which keeps the product predictable even when you reopen a chapter later.",
            primaryLabel: "Continue",
          },
          {
            title: "Навигация остаётся стабильной по всей shell",
            body:
              "У каждого важного сценария есть отдельный маршрут, поэтому продукт остаётся предсказуемым даже при повторном запуске главы позже.",
            primaryLabel: "Продолжить",
          },
        ),
      },
      {
        id: "shell-summary",
        type: "coachmark",
        targetId: "shell-header-primary",
        placement: "bottom",
        copy: copy(
          {
            title: "The shell header keeps session context visible",
            body:
              "Use the counters and quick controls to stay grounded in scope before you jump into a specific zone or admin action.",
            note: "Theme, language, jump-to-zone, and tutorial relaunch all live in this control strip.",
            primaryLabel: "Next",
          },
          {
            title: "Заголовок shell держит контекст сессии на виду",
            body:
              "Используйте счётчики и быстрые controls, чтобы не терять контур перед переходом в конкретную зону или админское действие.",
            note: "Здесь живут тема, язык, переход к зоне и повторный запуск tutorial.",
            primaryLabel: "Дальше",
          },
        ),
      },
    ],
  },
  {
    id: "zones-overview",
    kind: "route",
    routeKinds: ["zones"],
    copy: chapterCopy(
      "Zones",
      "Learn how the visible zone inventory is shaped for the current session.",
      "Зоны",
      "Поймите, как инвентарь зон формируется для текущей сессии.",
    ),
    isEligible: (context) => context.isAuthenticated,
    steps: [
      {
        id: "zones-nav",
        type: "coachmark",
        ensureRoute: { kind: "zones" },
        onNextNavigate: { kind: "zones" },
        targetId: "shell-nav-zones",
        placement: "right",
        copy: copy(
          {
            title: "Zones are the main operator entry point",
            body:
              "Start here when you need to understand what the current session can actually touch. The list is already permission-aware.",
            primaryLabel: "Open zones",
          },
          {
            title: "Зоны — главная точка входа оператора",
            body:
              "Начинайте здесь, когда нужно понять, с чем текущая сессия вообще может работать. Список уже учитывает права.",
            primaryLabel: "Открыть зоны",
          },
        ),
      },
      {
        id: "zones-search",
        type: "coachmark",
        ensureRoute: { kind: "zones" },
        targetId: "zones-search",
        placement: "bottom",
        copy: copy(
          {
            title: "Search cuts across zone name and backend owner",
            body:
              "Use this to narrow the visible inventory fast without guessing which backend currently serves a zone.",
            note: "Filtering changes only the viewport, not the session scope.",
            primaryLabel: "Next",
          },
          {
            title: "Поиск режет и имя зоны, и владеющий backend",
            body:
              "Используйте его, чтобы быстро сузить инвентарь без угадывания, какой backend сейчас обслуживает зону.",
            note: "Фильтр меняет только текущий viewport, а не контур прав.",
            primaryLabel: "Дальше",
          },
        ),
      },
      {
        id: "zones-card",
        type: "coachmark",
        ensureRoute: { kind: "zones" },
        targetId: "zones-primary-card",
        placement: "right",
        copy: copy(
          {
            title: "Zone cards answer three questions immediately",
            body:
              "What is managed, which backend owns it, and whether this session has a write path. Open a zone when you are ready to inspect or change records.",
            note: "Opening a zone does not mutate anything. It only moves you into the records workspace.",
            primaryLabel: "Continue to zone detail",
          },
          {
            title: "Карточки зон сразу отвечают на три вопроса",
            body:
              "Что управляется, какой backend владеет зоной и есть ли у этой сессии путь записи. Открывайте зону, когда готовы смотреть или менять записи.",
            note: "Открытие зоны ничего не мутирует. Оно только переносит вас в рабочую область записей.",
            primaryLabel: "Перейти к зоне",
          },
        ),
        onNextNavigate: (context) =>
          context.activeZoneName || context.preferredZoneName
            ? { kind: "zone", zoneName: context.activeZoneName ?? context.preferredZoneName! }
            : null,
        nextChapterId: "zone-detail",
      },
    ],
  },
  {
    id: "zone-detail",
    kind: "route",
    routeKinds: ["zone"],
    copy: chapterCopy(
      "Zone detail",
      "Inspect records, access posture, and preview-first editing.",
      "Детали зоны",
      "Изучите записи, контур доступа и редактирование через preview.",
    ),
    isEligible: (context) =>
      context.isAuthenticated &&
      (context.activeZoneName !== null || context.preferredZoneName !== null),
    steps: [
      {
        id: "zone-hero",
        type: "coachmark",
        ensureRoute: { kind: "zone", zoneName: "" },
        targetId: "zone-workspace-hero",
        placement: "bottom",
        copy: copy(
          {
            title: "Zone detail keeps the backend context visible",
            body:
              "This header tells you where the zone lives, whether the session is read-only, and which actions are currently safe.",
            primaryLabel: "Next",
          },
          {
            title: "Детали зоны держат backend-контекст на виду",
            body:
              "Этот header показывает, где живёт зона, остаётся ли сессия только для чтения и какие действия сейчас безопасны.",
            primaryLabel: "Дальше",
          },
        ),
      },
      {
        id: "zone-add-record",
        type: "coachmark",
        targetId: "zone-add-record",
        placement: "left",
        predicate: (context) => context.role !== "viewer",
        copy: copy(
          {
            title: "Writes start with preview, not blind apply",
            body:
              "Use Add record to draft a change, inspect the diff, and only then commit. The intent is to reduce fear and make state transitions obvious.",
            note: "If the session is read-only, this control stays hidden and the tutorial explains why instead of failing.",
            primaryLabel: "Next",
          },
          {
            title: "Запись начинается с preview, а не со слепого apply",
            body:
              "Используйте Add record, чтобы собрать изменение, посмотреть diff и только потом коммитить. Это уменьшает страх и делает переход состояния очевидным.",
            note: "Если сессия только для чтения, control скрыт, и tutorial объяснит почему, а не сломается.",
            primaryLabel: "Дальше",
          },
        ),
        fallbackCopy: copy(
          {
            title: "This session can inspect records safely",
            body:
              "The write controls are unavailable because the current role or backend path is read-only. You can still inspect records and understand current state.",
            primaryLabel: "Next",
          },
          {
            title: "Эта сессия может безопасно инспектировать записи",
            body:
              "Controls записи недоступны, потому что текущая роль или путь backend только для чтения. При этом записи и текущее состояние всё ещё можно изучать.",
            primaryLabel: "Дальше",
          },
        ),
      },
      {
        id: "zone-record-table",
        type: "coachmark",
        targetId: "zone-record-table",
        placement: "top",
        copy: copy(
          {
            title: "The record table is the operational truth surface",
            body:
              "Filter by type, inspect TTL and values, and use selection for controlled bulk deletes when the session allows it.",
            note: "After a successful mutation, this table is where the result becomes visible first.",
            primaryLabel: "Next",
          },
          {
            title: "Таблица записей — рабочая поверхность истины",
            body:
              "Фильтруйте по типу, проверяйте TTL и значения и используйте выборку для контролируемых массовых удалений, если сессия это разрешает.",
            note: "После успешной мутации именно здесь результат становится виден первым.",
            primaryLabel: "Дальше",
          },
        ),
      },
    ],
  },
  {
    id: "backends-overview",
    kind: "route",
    routeKinds: ["backends"],
    copy: chapterCopy(
      "Backends",
      "Read the operational shape of each backend before you trust a write path.",
      "Бэкенды",
      "Считывайте операционный профиль каждого backend до доверия пути записи.",
    ),
    isEligible: (context) => context.isAuthenticated,
    steps: [
      {
        id: "backends-nav",
        type: "coachmark",
        ensureRoute: { kind: "backends" },
        onNextNavigate: { kind: "backends" },
        targetId: "shell-nav-backends",
        placement: "right",
        copy: copy(
          {
            title: "Backends explain why a zone behaves the way it does",
            body:
              "Come here when you need capability context before changing state in a zone workspace.",
            primaryLabel: "Open backends",
          },
          {
            title: "Backends объясняют, почему зона ведёт себя именно так",
            body:
              "Возвращайтесь сюда, когда нужен capability-контекст перед изменением состояния внутри зоны.",
            primaryLabel: "Открыть backends",
          },
        ),
      },
      {
        id: "backends-card",
        type: "coachmark",
        targetId: "backend-primary-card",
        placement: "right",
        copy: copy(
          {
            title: "Backend cards show capability posture, not just metadata",
            body:
              "Use them to tell discovery-ready, read-only, and write-capable paths apart before you ask an operator to make a change.",
            primaryLabel: "Next",
          },
          {
            title: "Карточки backend показывают capability-posture, а не только метаданные",
            body:
              "Они помогают различать discovery-ready, read-only и write-capable paths до того, как вы попросите оператора что-то изменить.",
            primaryLabel: "Дальше",
          },
        ),
      },
    ],
  },
  {
    id: "audit-log",
    kind: "route",
    routeKinds: ["audit"],
    copy: chapterCopy(
      "Audit",
      "Verify who acted, what changed, and which object was touched.",
      "Аудит",
      "Проверяйте, кто действовал, что изменилось и какой объект был затронут.",
    ),
    isEligible: (context) => context.isAuthenticated,
    steps: [
      {
        id: "audit-nav",
        type: "coachmark",
        ensureRoute: { kind: "audit" },
        onNextNavigate: { kind: "audit" },
        targetId: "shell-nav-audit",
        placement: "right",
        copy: copy(
          {
            title: "Audit is where confidence comes back after a change",
            body:
              "Use this route to verify operator intent, action type, and target zone or backend without leaving the product.",
            primaryLabel: "Open audit",
          },
          {
            title: "Аудит возвращает уверенность после изменения",
            body:
              "Используйте этот маршрут, чтобы проверить намерение оператора, тип действия и целевую зону или backend, не покидая продукт.",
            primaryLabel: "Открыть аудит",
          },
        ),
      },
      {
        id: "audit-filters",
        type: "coachmark",
        targetId: "audit-filters",
        placement: "bottom",
        copy: copy(
          {
            title: "Filters narrow the investigation, not the evidence model",
            body:
              "Search by actor, zone, backend, or payload when you need to explain what happened after a successful or failed operation.",
            primaryLabel: "Next",
          },
          {
            title: "Фильтры сужают расследование, а не модель доказательств",
            body:
              "Ищите по actor, zone, backend или payload, когда нужно объяснить, что произошло после успешной или неуспешной операции.",
            primaryLabel: "Дальше",
          },
        ),
      },
    ],
  },
  {
    id: "access-control",
    kind: "route",
    routeKinds: ["admin-access"],
    copy: chapterCopy(
      "Access",
      "Manage roles and grants without mixing global posture and zone-level exceptions.",
      "Доступ",
      "Управляйте ролями и grants без смешивания глобального posture и точечных исключений.",
    ),
    isEligible: (context) => context.isAdmin,
    steps: [
      {
        id: "access-nav",
        type: "coachmark",
        ensureRoute: { kind: "admin-access" },
        onNextNavigate: { kind: "admin-access" },
        targetId: "shell-nav-admin-access",
        placement: "right",
        copy: copy(
          {
            title: "Access control is deliberately isolated",
            body:
              "Only admin sessions can change global roles and zone grants, so this workspace stays separate from day-to-day record operations.",
            primaryLabel: "Open access",
          },
          {
            title: "Управление доступом изолировано намеренно",
            body:
              "Только admin-сессии могут менять глобальные роли и zone grants, поэтому эта рабочая область отделена от повседневных операций с записями.",
            primaryLabel: "Открыть доступ",
          },
        ),
      },
      {
        id: "access-workspace",
        type: "coachmark",
        targetId: "admin-access-workspace",
        placement: "right",
        copy: copy(
          {
            title: "Set the broad role first, then narrow by zone",
            body:
              "This surface keeps the operator directory, selected user, and scoped zone grants together so you can reason about the final access outcome before saving.",
            primaryLabel: "Next",
          },
          {
            title: "Сначала задайте широкую роль, потом сужайте по зоне",
            body:
              "Эта поверхность держит каталог операторов, выбранного пользователя и scoped zone grants вместе, чтобы до сохранения было понятно итоговое право доступа.",
            primaryLabel: "Дальше",
          },
        ),
      },
    ],
  },
  {
    id: "identity-providers",
    kind: "route",
    routeKinds: ["admin-identity"],
    copy: chapterCopy(
      "Identity",
      "Keep sign-in posture visible while editing providers and claims mapping.",
      "Идентификация",
      "Держите posture входа на виду, пока редактируете providers и claims mapping.",
    ),
    isEligible: (context) => context.isAdmin,
    steps: [
      {
        id: "identity-nav",
        type: "coachmark",
        ensureRoute: { kind: "admin-identity" },
        onNextNavigate: { kind: "admin-identity" },
        targetId: "shell-nav-admin-identity",
        placement: "right",
        copy: copy(
          {
            title: "Identity setup is operational, not decorative",
            body:
              "Use this route to confirm provider count, local fallback, session TTL, and claims mapping before you roll sign-in changes out to operators.",
            primaryLabel: "Open identity",
          },
          {
            title: "Настройка identity — это операционная задача, а не декор",
            body:
              "Используйте этот маршрут, чтобы проверить число providers, локальный fallback, TTL сессии и claims mapping до выката изменений входа на операторов.",
            primaryLabel: "Открыть identity",
          },
        ),
      },
      {
        id: "identity-workspace",
        type: "coachmark",
        targetId: "admin-identity-workspace",
        placement: "right",
        copy: copy(
          {
            title: "Provider edits stay readable for operators",
            body:
              "Issuer, scopes, and claims mapping are presented together so an operator can understand what a successful sign-in should produce.",
            primaryLabel: "Next",
          },
          {
            title: "Редактирование provider остаётся читаемым для операторов",
            body:
              "Issuer, scopes и claims mapping показаны вместе, чтобы оператор мог понять, что должен дать успешный вход.",
            primaryLabel: "Дальше",
          },
        ),
      },
    ],
  },
  {
    id: "preferences-and-help",
    kind: "core",
    routeKinds: ["zones", "zone", "backends", "audit", "admin-access", "admin-backends", "admin-identity"],
    copy: chapterCopy(
      "Preferences and help",
      "Switch language and theme safely, then return to this tutorial whenever needed.",
      "Настройки и помощь",
      "Безопасно меняйте язык и тему, а затем возвращайте tutorial когда нужно.",
    ),
    isEligible: (context) => context.isAuthenticated,
    steps: [
      {
        id: "preferences-locale",
        type: "coachmark",
        targetId: "shell-locale-toggle",
        placement: "bottom",
        copy: copy(
          {
            title: "Language switches keep the workspace intact",
            body:
              "You can move between EN and RU at any time. The tutorial follows the same locale immediately without resetting progress.",
            primaryLabel: "Next",
          },
          {
            title: "Переключение языка сохраняет целостность workspace",
            body:
              "В любой момент можно перейти между EN и RU. Tutorial сразу следует за локалью и не сбрасывает прогресс.",
            primaryLabel: "Дальше",
          },
        ),
      },
      {
        id: "preferences-theme",
        type: "coachmark",
        targetId: "shell-theme-toggle",
        placement: "bottom",
        copy: copy(
          {
            title: "Theme changes are supported mid-flow",
            body:
              "The tutorial layer is theme-aware and stays legible over both dark and light surfaces while the shell transition runs.",
            primaryLabel: "Next",
          },
          {
            title: "Смена темы поддерживается прямо по ходу walkthrough",
            body:
              "Слой tutorial учитывает тему и остаётся читаемым поверх dark и light surfaces, пока проигрывается transition shell.",
            primaryLabel: "Дальше",
          },
        ),
      },
      {
        id: "preferences-help",
        type: "coachmark",
        targetId: "shell-tutorial-launcher",
        placement: "bottom",
        copy: copy(
          {
            title: "Tutorials stay available after onboarding",
            body:
              "Use this entry point to continue an unfinished tour, replay a chapter, or restart the full onboarding later.",
            note: "Even Never show again only disables auto-start. Manual launch always remains available.",
            primaryLabel: "Finish",
          },
          {
            title: "Tutorial остаётся доступным и после onboarding",
            body:
              "Используйте эту точку входа, чтобы продолжить незавершённый тур, повторить главу или позже перезапустить весь onboarding.",
            note: "Даже режим «Больше не показывать» отключает только автостарт. Ручной запуск остаётся всегда.",
            primaryLabel: "Завершить",
          },
        ),
        canDismissForever: true,
      },
    ],
  },
];

export function getTutorialChapter(id: string) {
  return tutorialRegistry.find((chapter) => chapter.id === id) ?? null;
}
