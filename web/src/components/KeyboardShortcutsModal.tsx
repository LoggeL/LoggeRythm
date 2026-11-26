"use client";

import Modal from "@/components/Modal";
import { useUiModalsStore } from "@/store/uiModals";

interface ShortcutItem {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: "Wiedergabe",
    items: [
      { keys: ["Leertaste"], label: "Abspielen / Pausieren" },
      { keys: ["Shift", "N"], label: "Nächster Titel" },
      { keys: ["Shift", "P"], label: "Vorheriger Titel" },
      { keys: ["←", "→"], label: "5 Sekunden zurück / vor" },
      { keys: ["0", "–", "9"], label: "Zu 0 % – 90 % springen" },
      { keys: ["↑", "↓"], label: "Lautstärke anpassen" },
      { keys: ["M"], label: "Stummschalten" },
      { keys: ["S"], label: "Zufallswiedergabe umschalten" },
      { keys: ["R"], label: "Wiederholen durchschalten" },
    ],
  },
  {
    title: "Titel & Ansichten",
    items: [
      { keys: ["L"], label: "Aktuellen Titel liken / entliken" },
      { keys: ["A"], label: "Aktuellen Titel zu Playlist hinzufügen" },
      { keys: ["Q"], label: "Warteschlange öffnen / schließen" },
      { keys: ["T"], label: "Songtext-Dock öffnen / schließen" },
      { keys: ["F"], label: "Vollbildplayer öffnen / schließen" },
      { keys: ["V"], label: "Visualizer-Szene wechseln" },
      { keys: ["C"], label: "Kino-Modus (Vollbild-Visualizer)" },
      { keys: ["D"], label: "Geräte & Connect öffnen" },
    ],
  },
  {
    title: "Suche & Befehle",
    items: [
      { keys: ["⌘", "K"], label: "Befehls- & Suchpalette öffnen" },
      { keys: [">"], label: "Nur App-Befehle in der Palette" },
      { keys: ["Shift", "↵"], label: "Suchtreffer als Nächstes spielen" },
      { keys: ["Alt", "↵"], label: "Suchtreffer zur Warteschlange" },
      { keys: ["/"], label: "Suchfeld fokussieren" },
      { keys: ["?"], label: "Diese Übersicht öffnen / schließen" },
    ],
  },
];

const KBD =
  "inline-grid min-h-[22px] min-w-[24px] place-items-center rounded-[5px] border border-border bg-foreground/[0.05] px-1.5 font-mono text-[11px] font-medium leading-none text-foreground";

export default function KeyboardShortcutsModal() {
  const open = useUiModalsStore((s) => s.shortcutsOpen);
  const setOpen = useUiModalsStore((s) => s.setShortcutsOpen);

  if (!open) return null;

  return (
    <Modal
      open={open}
      size="md"
      onClose={() => setOpen(false)}
      title="Tastenkürzel"
      description="Aktiv, sobald kein Eingabefeld fokussiert ist."
      footer={
        <button data-dialog-autofocus type="button" onClick={() => setOpen(false)} className="action-secondary">
          Schließen
        </button>
      }
    >
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="label-mono mb-2 border-b border-hairline pb-1.5">{group.title}</h3>
            <dl className="divide-y divide-hairline">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <dt className="min-w-0 text-muted">{item.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {item.keys.map((token, idx) => (
                      <kbd key={`${token}-${idx}`} className={KBD}>
                        {token}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
