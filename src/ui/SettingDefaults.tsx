import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  resolveSettingDefault,
  saveSettingDefault,
  type SettingValue,
} from "../core/setting-defaults";
import type { JobMaterial, MaterialLibrary } from "../core/job";

type Request = {
  key: string;
  value: SettingValue;
  fallback: SettingValue;
  material?: JobMaterial;
  apply: (value: SettingValue) => void;
  scope: string;
};
const DefaultsContext = createContext<
  (event: React.MouseEvent, request: Request) => void
>(() => {});
const GlobalDefaultsContext=createContext<MaterialLibrary["settingDefaults"]>({});
export function useGlobalDefault(key:string,fallback:SettingValue) { return useContext(GlobalDefaultsContext)?.[key] ?? fallback; }
export function SettingsScope({
  children,
  values,
  fallbacks = {},
  onRevert,
  material,
  title,
  prefix = "",
}: {
  children: ReactNode;
  values: Record<string, unknown>;
  fallbacks?: Record<string, unknown>;
  onRevert: (key: string, value: any) => void;
  material?: JobMaterial;
  title: string;
  prefix?: string;
}) {
  const open = useContext(DefaultsContext);
  return (
    <div
      style={{ display: "contents" }}
      onContextMenu={(e) => {
        if (e.defaultPrevented) return;
        const target =
          (e.target as Element).closest<HTMLElement>("[data-default-key]") ??
          (e.target as Element)
            .closest("label")
            ?.querySelector<HTMLElement>("[data-default-key]");
        if (!target) return;
        const key = target.dataset.defaultKey!;
        if (!(key in values)) return;
        open(e, {
          key: prefix + key,
          value: (values[key] ?? null) as SettingValue,
          fallback: (fallbacks[key] ?? null) as SettingValue,
          material,
          scope: title,
          apply: (v) => onRevert(key, v),
        });
      }}
    >
      {children}
    </div>
  );
}
export function SettingDefaultsProvider({
  library,
  onChange,
  onMessage,
  children,
}: {
  library: MaterialLibrary;
  onChange: (library: MaterialLibrary) => void;
  onMessage: (message: string) => void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState<{
    request: Request;
    x: number;
    y: number;
    host: HTMLElement;
  } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null),
      key = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  return (
    <GlobalDefaultsContext.Provider value={library.settingDefaults}><DefaultsContext.Provider
      value={(e, request) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({
          request,
          x: Math.max(8, Math.min(e.clientX, window.innerWidth - 280)),
          y: Math.max(8, Math.min(e.clientY, window.innerHeight - 150)),
          host: (e.target as Element).closest("dialog") ?? document.body,
        });
      }}
    >
      {children}
      {menu &&
        createPortal(
          <div
            role="menu"
            aria-label="Setting defaults"
            className="setting-default-menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="micro">{menu.request.scope}</div>
            <button
              role="menuitem"
              autoFocus
              onClick={() => {
                try {
                  onChange(
                    saveSettingDefault(
                      library,
                      menu.request.key,
                      menu.request.value,
                      menu.request.material,
                    ),
                  );
                  onMessage(`Default saved · ${menu.request.scope}`);
                } catch (e) {
                  onMessage((e as Error).message);
                }
                setMenu(null);
              }}
            >
              Save as default
            </button>
            <button
              role="menuitem"
              onClick={() => {
                menu.request.apply(
                  resolveSettingDefault(
                    library,
                    menu.request.key,
                    menu.request.fallback,
                    menu.request.material,
                  ),
                );
                setMenu(null);
              }}
            >
              Revert to default
            </button>
          </div>,
          menu.host,
        )}
    </DefaultsContext.Provider></GlobalDefaultsContext.Provider>
  );
}
