import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * A minimal hash router.
 *
 * Four static screens do not justify pulling in a routing library, and a hash
 * route means the app also works when opened straight off the filesystem or
 * served from a subpath on a plant intranet.
 */
const RouterContext = createContext<{
  path: string;
  navigate: (to: string) => void;
}>({ path: "/", navigate: () => {} });

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}

export function Link({
  to,
  children,
  className,
  title,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={`#${to}`}
      className={className}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
