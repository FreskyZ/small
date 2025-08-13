import { useEffect, useState, ReactNode, createContext, useContext } from "react";

type Route = {
    path: string;
    element: ReactNode;
};

type RouterProps = {
    routes: Route[];
    fallback?: ReactNode;
};

type RouterContextType = {
    push: (path: string) => void;
    replace: (path: string) => void;
    path: string;
};

const RouterContext = createContext<RouterContextType | undefined>(undefined);

export function useRouter() {
    const ctx = useContext(RouterContext);
    if (!ctx) throw new Error("useRouter must be used within a Router");
    return ctx;
}

function matchRoute(path: string, routes: Route[]) {
    return routes.find(route => route.path === path);
}

export function Router({ routes, fallback = null }: RouterProps) {
    const [path, setPath] = useState(window.location.pathname);

    useEffect(() => {
        const onPopState = () => setPath(window.location.pathname);
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, []);

    const push = (to: string) => {
        if (to !== path) {
            window.history.pushState({}, "", to);
            setPath(to);
        }
    };

    const replace = (to: string) => {
        if (to !== path) {
            window.history.replaceState({}, "", to);
            setPath(to);
        }
    };

    const route = matchRoute(path, routes);

    return (
        <RouterContext.Provider value={{ push, replace, path }}>
            {route ? route.element : fallback}
        </RouterContext.Provider>
    );
}

type LinkProps = {
    to: string;
    children: ReactNode;
    replace?: boolean;
};

export function Link({ to, children, replace = false }: LinkProps) {
    const router = useRouter();
    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        replace ? router.replace(to) : router.push(to);
    };
    return (
        <a href={to} onClick={handleClick}>
            {children}
        </a>
    );
}