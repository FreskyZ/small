

const QueryKeyNames = {
    'long-name': 'l',
    'long-name-2': 'o',
    // ...
};
type QueryKeyName = keyof typeof QueryKeyNames;

// the structured data stored in location used in this application
// these are example names in /user/:segment2/item/:segment3?query
interface Data {
    segment2: string,
    segment3: string,
    query: Record<string, string>,
}

interface NavigationTarget {
    segment2: string,
    segment3: string,
    // set to null to remove
    query: Partial<Record<QueryKeyName, string>>,
}

const ParseExpression = /^.\/user\/(?<segment3>\w+)...$/;

function resolve(): Data {
    const match = ParseExpression.exec(window.location.hash);
    // return null for parse error
    return { segment2: '...', segment3: '...', query: Object.fromEntries(new URLSearchParams(match.groups['query']).entries()) };
}

// merge with map human friendly query key name to actual query key
function mergeQuery(query: Record<QueryKeyName, string>, target: Partial<Record<QueryKeyName, string>>) {
    return Object.assign(query, Object.fromEntries(Object.entries(target || {}).map(([k, v]) => [QueryKeyNames[k as QueryKeyName], v])));
}

// make hash from data, include the leading #
function makehash(data: Data): string {
    const queryEntries = Object.entries(data.query ?? {}).filter(q => q[1]);
    const query = queryEntries.length ? `?${new URLSearchParams(queryEntries)}` : '';
    return '#'
        + '/user' + data.segment2
        + '/item' + data.segment3
        + query;
}

// make full url by replace current location's hash
function makeurl(data: Data) {
    const url = new URL(window.location.toString());
    url.hash = makehash(data);
    return url.toString();
}

class QueryData {
    public constructor(
        private readonly getData: () => Record<string, string>,
    ) {}
    
    // get by key name, not the actual key
    public get(name: QueryKeyName) {
        return this.getData()[QueryKeyNames[name]];
    }
}

class CurrentLocation {
    private data: Data;

    // apply this.data to window.location.hash
    //
    // there are many apis to change hash
    // - window.location.assign, trigger hashchange, can go back
    // - window.location.replace, trigger hashchange, cannot go back
    // - window.history.pushState, not trigger hashchange, can go back
    // - window.history.replaceState, not trigger hashchange, cannot go back
    // - <a href='#...' />, trigger hashchange, can go back
    //
    // according to actual usage in this application
    // - many manual change is for normalizing or fixing incorrect location, include other invocations inside this class
    //   these change operations are not interested by other listening components, and should not go back, so use history.replaceState
    // - all click to navigation should use <Link>, which makes a correct <a>
    // - other real navigation should notify and can go back, which is location.assign
    private apply(kind: 'set' | 'navigate') {
        if (kind == 'set') {
            window.history.replaceState(null, '', makeurl(this.data));
        } else {
            window.location.assign(makeurl(this.data));
        }
    }

    public get segment2() { return this.data.segment2; }
    public get segment3() { return this.data.segment3; }
    public readonly query: QueryData = new QueryData(() => this.data.query);

    // checks whether page have unsaved change before leave current location, abbreviated as checker
    private checker: () => boolean;
    // set leave check callback, does not need manual clear most of the time
    public setChecker(f: () => boolean): () => void {
        this.checker = f;
        return () => this.checker = null;
    }
    // set leave check callback
    public useCheck(f: () => boolean) {
        useEffect(() => this.setChecker(f), []);
    }

    private readonly handlers: (() => void)[] = [];
    public addEventListener(f: () => void): () => void {
        this.handlers.push(f);
        return () => {
            const index = this.handlers.indexOf(f);
            if (index >= 0) {
                this.handlers.splice(index, 1);
            }
        };
    }
    private notify() {
        for (const handler of this.handlers) {
            setTimeout(handler);
        }
    }

    // normalize location, does not notify, callers need to refresh state on their own
    public set(kind: 'path' | 'query', target: NavigationTarget | NavigationTarget['query']) {
        if (kind == 'path') {
            const { query, ...rest } = target || {};
            Object.assign(this.data, rest);
            mergeQuery(this.data.query, query);
        } else {
            mergeQuery(this.data.query, target);
        }
        this.apply('set');
    }

    public navigate(target: NavigationTarget) {
        const { query, ...rest } = target || {};
        Object.assign(this.data, rest);
        mergeQuery(this.data.query, query);
        this.apply('navigate');
    }

    // when meet really invalid state, go back to home page
    public clear() {
        this.data = { query: {} };
        this.apply('set');
        this.notify();
    }

    // return new hash by target, use by <Link>
    public dryset(target: NavigationTarget): string {
        const { query, ...rest } = target;
        const newQuery = mergeQuery({ ...this.data.query }, query);
        return makehash({ ...this.data, ...rest, query: newQuery });
    }

    private readonly handleHashChange = (e: HashChangeEvent) => {
        if (typeof this.checker == 'function' && this.checker()) {
            // pretend nothing change by silently go back by replace
            window.history.replaceState(null, '', e.oldURL);
            // and navigate to target again if click ok
            // use any confirm modal function of your ui framework
            popup.confirm('Do you want to level without saving?', () => {
                this.checker = null;
                // this trigger this event again with previously wanted new url
                window.location.assign(e.newURL);
            });
        } else {
            this.checker = null;
            this.data = resolve();
            if (!this.data) {
                this.data = { query: {} };
                this.apply('set');
            }
            this.notify();
        }
    }

    // use when you don't care about what to do in event handler and use complete rerender
    public useLocation() {
        useSyncExternalStore(f => this.addEventListener(f), () => this.data);
    }

    public constructor() {
        this.data = resolve();
        if (!this.data) {
            this.data = { query: {} };
            this.apply('set');
        }
        // this is application lifetime and don't need removeEventListener
        window.addEventListener('hashchange', this.handleHashChange);
    }
}
export const currentlocation = window['currentlocation'] = new CurrentLocation();
