// auto generated

type int = number; // abs <= max safe int
type uint = number; // <= max safe int
type float = number;
type text = string;

// implementation defined non exhausitive
export type Command = CommandData & {
    id: uint,
}

export type CommandData = 
    | browser.Command
    | browsingContext.Command
    | emulation.Command
    | input.Command
    | network.Command
    | script.Command
    | session.Command
    | storage.Command
    | webExtension.Command;

// implementation defined non exhausitive
export interface EmptyParams {
}

export type Message = CommandResponse | ErrorResponse | Event;

// implementation defined non exhausitive
export interface CommandResponse {
    type: 'success',
    id: uint,
    result: ResultData,
}

// implementation defined non exhausitive
export interface ErrorResponse {
    type: 'error',
    id: uint | null,
    error: ErrorCode,
    message: text,
    stacktrace?: text,
}

export type ResultData = 
    | browser.Result
    | browsingContext.Result
    | emulation.Result
    | input.Result
    | network.Result
    | script.Result
    | session.Result
    | storage.Result
    | webExtension.Result;

// implementation defined non exhausitive
export interface EmptyResult {
}

// implementation defined non exhausitive
export type Event = EventData & {
    type: 'event',
}

export type EventData = 
    | browsingContext.Event
    | input.Event
    | log.Event
    | network.Event
    | script.Event;

export type ErrorCode = 
    | 'invalid argument'
    | 'invalid selector'
    | 'invalid session id'
    | 'invalid web extension'
    | 'move target out of bounds'
    | 'no such alert'
    | 'no such network collector'
    | 'no such element'
    | 'no such frame'
    | 'no such handle'
    | 'no such history entry'
    | 'no such intercept'
    | 'no such network data'
    | 'no such node'
    | 'no such request'
    | 'no such script'
    | 'no such storage partition'
    | 'no such user context'
    | 'no such web extension'
    | 'session not created'
    | 'unable to capture screen'
    | 'unable to close browser'
    | 'unable to set cookie'
    | 'unable to set file input'
    | 'unavailable network data'
    | 'underspecified storage partition'
    | 'unknown command'
    | 'unknown error'
    | 'unsupported operation';

export type Method = Command['method'];
export type MethodMap<M extends Method> = Extract<Command, { method: M }>['params'];
export type MethodResultMap = {
    'session.end': session.EndResult,
    'session.new': session.NewResult,
    'session.status': session.StatusResult,
    'session.subscribe': session.SubscribeResult,
    'session.unsubscribe': session.UnsubscribeResult,
    'browser.close': browser.CloseResult,
    'browser.createUserContext': browser.CreateUserContextResult,
    'browser.getClientWindows': browser.GetClientWindowsResult,
    'browser.getUserContexts': browser.GetUserContextsResult,
    'browser.removeUserContext': browser.RemoveUserContextResult,
    'browser.setClientWindowState': browser.SetClientWindowStateResult,
    'browser.setDownloadBehavior': browser.SetDownloadBehaviorResult,
    'browsingContext.activate': browsingContext.ActivateResult,
    'browsingContext.captureScreenshot': browsingContext.CaptureScreenshotResult,
    'browsingContext.close': browsingContext.CloseResult,
    'browsingContext.create': browsingContext.CreateResult,
    'browsingContext.getTree': browsingContext.GetTreeResult,
    'browsingContext.handleUserPrompt': browsingContext.HandleUserPromptResult,
    'browsingContext.locateNodes': browsingContext.LocateNodesResult,
    'browsingContext.navigate': browsingContext.NavigateResult,
    'browsingContext.print': browsingContext.PrintResult,
    'browsingContext.reload': browsingContext.ReloadResult,
    'browsingContext.setViewport': browsingContext.SetViewportResult,
    'browsingContext.traverseHistory': browsingContext.TraverseHistoryResult,
    'emulation.setForcedColorsModeThemeOverride': emulation.SetForcedColorsModeThemeOverrideResult,
    'emulation.setGeolocationOverride': emulation.SetGeolocationOverrideResult,
    'emulation.setLocaleOverride': emulation.SetLocaleOverrideResult,
    'emulation.setNetworkConditions': emulation.SetNetworkConditionsResult,
    'emulation.setScreenOrientationOverride': emulation.SetScreenOrientationOverrideResult,
    'emulation.setScreenSettingsOverride': emulation.SetScreenSettingsOverrideResult,
    'emulation.setScriptingEnabled': emulation.SetScriptingEnabledResult,
    'emulation.setScrollbarTypeOverride': emulation.SetScrollbarTypeOverrideResult,
    'emulation.setTimezoneOverride': emulation.SetTimezoneOverrideResult,
    'emulation.setTouchOverride': emulation.SetTouchOverrideResult,
    'emulation.setUserAgentOverride': emulation.SetUserAgentOverrideResult,
    'network.addDataCollector': network.AddDataCollectorResult,
    'network.addIntercept': network.AddInterceptResult,
    'network.continueRequest': network.ContinueRequestResult,
    'network.continueResponse': network.ContinueResponseResult,
    'network.continueWithAuth': network.ContinueWithAuthResult,
    'network.disownData': network.DisownDataResult,
    'network.failRequest': network.FailRequestResult,
    'network.getData': network.GetDataResult,
    'network.provideResponse': network.ProvideResponseResult,
    'network.removeDataCollector': network.RemoveDataCollectorResult,
    'network.removeIntercept': network.RemoveInterceptResult,
    'network.setCacheBehavior': network.SetCacheBehaviorResult,
    'network.setExtraHeaders': network.SetExtraHeadersResult,
    'script.addPreloadScript': script.AddPreloadScriptResult,
    'script.callFunction': script.CallFunctionResult,
    'script.disown': script.DisownResult,
    'script.evaluate': script.EvaluateResult,
    'script.getRealms': script.GetRealmsResult,
    'script.removePreloadScript': script.RemovePreloadScriptResult,
    'storage.deleteCookies': storage.DeleteCookiesResult,
    'storage.getCookies': storage.GetCookiesResult,
    'storage.setCookie': storage.SetCookieResult,
    'input.performActions': input.PerformActionsResult,
    'input.releaseActions': input.ReleaseActionsResult,
    'input.setFiles': input.SetFilesResult,
    'webExtension.install': webExtension.InstallResult,
    'webExtension.uninstall': webExtension.UninstallResult,
}
export type EventName = Event['method'];

export namespace session {

    export interface CapabilitiesRequest {
        alwaysMatch?: session.CapabilityRequest,
        firstMatch?: session.CapabilityRequest[],
    }

    // implementation defined non exhausitive
    export interface CapabilityRequest {
        acceptInsecureCerts?: boolean,
        browserName?: text,
        browserVersion?: text,
        platformName?: text,
        proxy?: session.ProxyConfiguration,
        unhandledPromptBehavior?: session.UserPromptHandler,
    }

    export type ProxyConfiguration = 
        | session.AutodetectProxyConfiguration
        | session.DirectProxyConfiguration
        | session.ManualProxyConfiguration
        | session.PacProxyConfiguration
        | session.SystemProxyConfiguration;

    // implementation defined non exhausitive
    export interface AutodetectProxyConfiguration {
        proxyType: 'autodetect',
    }

    // implementation defined non exhausitive
    export interface DirectProxyConfiguration {
        proxyType: 'direct',
    }

    // implementation defined non exhausitive
    export interface ManualProxyConfiguration extends session.SocksProxyConfiguration {
        proxyType: 'manual',
        httpProxy?: text,
        sslProxy?: text,
        noProxy?: text[],
    }

    export interface SocksProxyConfiguration {
        socksProxy: text,
        socksVersion: /* 0..255 */ number,
    }

    // implementation defined non exhausitive
    export interface PacProxyConfiguration {
        proxyType: 'pac',
        proxyAutoconfigUrl: text,
    }

    // implementation defined non exhausitive
    export interface SystemProxyConfiguration {
        proxyType: 'system',
    }

    export interface UserPromptHandler {
        alert?: session.UserPromptHandlerType,
        beforeUnload?: session.UserPromptHandlerType,
        confirm?: session.UserPromptHandlerType,
        default?: session.UserPromptHandlerType,
        file?: session.UserPromptHandlerType,
        prompt?: session.UserPromptHandlerType,
    }

    export type UserPromptHandlerType = 'accept' | 'dismiss' | 'ignore';

    export type Subscription = text;

    export interface SubscribeParameters {
        events: /* >0 */ text[],
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface UnsubscribeByIDRequest {
        subscriptions: /* >0 */ session.Subscription[],
    }

    export interface UnsubscribeByAttributesRequest {
        events: /* >0 */ text[],
    }

    export interface NewParameters {
        capabilities: session.CapabilitiesRequest,
    }

    export type UnsubscribeParameters = session.UnsubscribeByAttributesRequest | session.UnsubscribeByIDRequest;

    export type Command = 
        | session.End
        | session.New
        | session.Status
        | session.Subscribe
        | session.Unsubscribe;

    export type Result = 
        | session.EndResult
        | session.NewResult
        | session.StatusResult
        | session.SubscribeResult
        | session.UnsubscribeResult;

    export interface End {
        method: 'session.end',
        params: EmptyParams,
    }

    export type EndResult = EmptyResult;

    export interface New {
        method: 'session.new',
        params: session.NewParameters,
    }

    export interface NewResult {
        sessionId: text,
        capabilities: {
            acceptInsecureCerts: boolean,
            browserName: text,
            browserVersion: text,
            platformName: text,
            setWindowRect: boolean,
            userAgent: text,
            proxy?: session.ProxyConfiguration,
            unhandledPromptBehavior?: session.UserPromptHandler,
            webSocketUrl?: text,
        },
    }

    export interface Status {
        method: 'session.status',
        params: EmptyParams,
    }

    export interface StatusResult {
        ready: boolean,
        message: text,
    }

    export interface Subscribe {
        method: 'session.subscribe',
        params: session.SubscribeParameters,
    }

    export interface SubscribeResult {
        subscription: session.Subscription,
    }

    export interface Unsubscribe {
        method: 'session.unsubscribe',
        params: session.UnsubscribeParameters,
    }

    export type UnsubscribeResult = EmptyResult;
}

export namespace browser {

    export type ClientWindow = text;

    export interface ClientWindowInfo {
        active: boolean,
        clientWindow: browser.ClientWindow,
        height: uint,
        state: 
            | 'fullscreen'
            | 'maximized'
            | 'minimized'
            | 'normal',
        width: uint,
        x: int,
        y: int,
    }

    export type UserContext = text;

    export interface UserContextInfo {
        userContext: browser.UserContext,
    }

    export interface CreateUserContextParameters {
        acceptInsecureCerts?: boolean,
        proxy?: session.ProxyConfiguration,
        unhandledPromptBehavior?: session.UserPromptHandler,
    }

    export interface RemoveUserContextParameters {
        userContext: browser.UserContext,
    }

    export type SetClientWindowStateParameters =
        & browser.ClientWindowNamedState
        & browser.ClientWindowRectState
        & {
        clientWindow: browser.ClientWindow,
    }

    export interface ClientWindowNamedState {
        state: 'fullscreen' | 'maximized' | 'minimized',
    }

    export interface ClientWindowRectState {
        state: 'normal',
        width?: uint,
        height?: uint,
        x?: int,
        y?: int,
    }

    export interface SetDownloadBehaviorParameters {
        downloadBehavior: browser.DownloadBehavior | null,
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export type DownloadBehavior = browser.DownloadBehaviorAllowed | browser.DownloadBehaviorDenied;

    export interface DownloadBehaviorAllowed {
        type: 'allowed',
        destinationFolder: text,
    }

    export interface DownloadBehaviorDenied {
        type: 'denied',
    }

    export type Command = 
        | browser.Close
        | browser.CreateUserContext
        | browser.GetClientWindows
        | browser.GetUserContexts
        | browser.RemoveUserContext
        | browser.SetClientWindowState
        | browser.SetDownloadBehavior;

    export type Result = 
        | browser.CloseResult
        | browser.CreateUserContextResult
        | browser.GetClientWindowsResult
        | browser.GetUserContextsResult
        | browser.RemoveUserContextResult
        | browser.SetClientWindowStateResult
        | browser.SetDownloadBehaviorResult;

    export interface Close {
        method: 'browser.close',
        params: EmptyParams,
    }

    export type CloseResult = EmptyResult;

    export interface CreateUserContext {
        method: 'browser.createUserContext',
        params: browser.CreateUserContextParameters,
    }

    export type CreateUserContextResult = browser.UserContextInfo;

    export interface GetClientWindows {
        method: 'browser.getClientWindows',
        params: EmptyParams,
    }

    export interface GetClientWindowsResult {
        clientWindows: browser.ClientWindowInfo[],
    }

    export interface GetUserContexts {
        method: 'browser.getUserContexts',
        params: EmptyParams,
    }

    export interface GetUserContextsResult {
        userContexts: /* >0 */ browser.UserContextInfo[],
    }

    export interface RemoveUserContext {
        method: 'browser.removeUserContext',
        params: browser.RemoveUserContextParameters,
    }

    export type RemoveUserContextResult = EmptyResult;

    export interface SetClientWindowState {
        method: 'browser.setClientWindowState',
        params: browser.SetClientWindowStateParameters,
    }

    export type SetClientWindowStateResult = browser.ClientWindowInfo;

    export interface SetDownloadBehavior {
        method: 'browser.setDownloadBehavior',
        params: browser.SetDownloadBehaviorParameters,
    }

    export type SetDownloadBehaviorResult = EmptyResult;
}

export namespace browsingContext {

    export type BrowsingContext = text;

    export type InfoList = browsingContext.Info[];

    export interface Info {
        children: browsingContext.InfoList | null,
        clientWindow: browser.ClientWindow,
        context: browsingContext.BrowsingContext,
        originalOpener: browsingContext.BrowsingContext | null,
        url: text,
        userContext: browser.UserContext,
        parent?: browsingContext.BrowsingContext | null,
    }

    export type Locator = 
        | browsingContext.AccessibilityLocator
        | browsingContext.CssLocator
        | browsingContext.ContextLocator
        | browsingContext.InnerTextLocator
        | browsingContext.XPathLocator;

    export interface AccessibilityLocator {
        type: 'accessibility',
        value: {
            name?: text,
            role?: text,
        },
    }

    export interface CssLocator {
        type: 'css',
        value: text,
    }

    export interface ContextLocator {
        type: 'context',
        value: {
            context: browsingContext.BrowsingContext,
        },
    }

    export interface InnerTextLocator {
        type: 'innerText',
        value: text,
        ignoreCase?: boolean,
        matchType?: 'full' | 'partial',
        maxDepth?: uint,
    }

    export interface XPathLocator {
        type: 'xpath',
        value: text,
    }

    export type Navigation = text;

    export interface BaseNavigationInfo {
        context: browsingContext.BrowsingContext,
        navigation: browsingContext.Navigation | null,
        timestamp: uint,
        url: text,
        userContext?: browser.UserContext,
    }

    export interface NavigationInfo extends browsingContext.BaseNavigationInfo {
    }

    export type ReadinessState = 'none' | 'interactive' | 'complete';

    export type UserPromptType = 
        | 'alert'
        | 'beforeunload'
        | 'confirm'
        | 'prompt';

    export interface ActivateParameters {
        context: browsingContext.BrowsingContext,
    }

    export interface CaptureScreenshotParameters {
        context: browsingContext.BrowsingContext,
        origin?: /* default viewport */ 'viewport' | 'document',
        format?: browsingContext.ImageFormat,
        clip?: browsingContext.ClipRectangle,
    }

    export interface ImageFormat {
        type: text,
        quality?: /* 0..1 */ number,
    }

    export type ClipRectangle = browsingContext.BoxClipRectangle | browsingContext.ElementClipRectangle;

    export interface ElementClipRectangle {
        type: 'element',
        element: script.SharedReference,
    }

    export interface BoxClipRectangle {
        type: 'box',
        x: float,
        y: float,
        width: float,
        height: float,
    }

    export interface CloseParameters {
        context: browsingContext.BrowsingContext,
        promptUnload?: /* default false */ boolean,
    }

    export type CreateType = 'tab' | 'window';

    export interface CreateParameters {
        type: browsingContext.CreateType,
        referenceContext?: browsingContext.BrowsingContext,
        background?: /* default false */ boolean,
        userContext?: browser.UserContext,
    }

    export interface GetTreeParameters {
        maxDepth?: uint,
        root?: browsingContext.BrowsingContext,
    }

    export interface HandleUserPromptParameters {
        context: browsingContext.BrowsingContext,
        accept?: boolean,
        userText?: text,
    }

    export interface LocateNodesParameters {
        context: browsingContext.BrowsingContext,
        locator: browsingContext.Locator,
        maxNodeCount?: /* >= 1 */ uint,
        serializationOptions?: script.SerializationOptions,
        startNodes?: /* >0 */ script.SharedReference[],
    }

    export interface NavigateParameters {
        context: browsingContext.BrowsingContext,
        url: text,
        wait?: browsingContext.ReadinessState,
    }

    export interface PrintParameters {
        context: browsingContext.BrowsingContext,
        background?: /* default false */ boolean,
        margin?: browsingContext.PrintMarginParameters,
        orientation?: /* default portrait */ 'portrait' | 'landscape',
        page?: browsingContext.PrintPageParameters,
        pageRanges?: (uint | text)[],
        scale?: /* default 1 */ /* 0.1..2 */ number,
        shrinkToFit?: /* default true */ boolean,
    }

    export interface PrintMarginParameters {
        bottom?: /* default 1 */ /* >= 0 */ float,
        left?: /* default 1 */ /* >= 0 */ float,
        right?: /* default 1 */ /* >= 0 */ float,
        top?: /* default 1 */ /* >= 0 */ float,
    }

    export interface PrintPageParameters {
        height?: /* default 27.94 */ /* >= 0.0352 */ float,
        width?: /* default 21.59 */ /* >= 0.0352 */ float,
    }

    export interface ReloadParameters {
        context: browsingContext.BrowsingContext,
        ignoreCache?: boolean,
        wait?: browsingContext.ReadinessState,
    }

    export interface SetViewportParameters {
        context?: browsingContext.BrowsingContext,
        viewport?: browsingContext.Viewport | null,
        devicePixelRatio?: /* > 0 */ float | null,
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface Viewport {
        width: uint,
        height: uint,
    }

    export interface TraverseHistoryParameters {
        context: browsingContext.BrowsingContext,
        delta: int,
    }

    export interface HistoryUpdatedParameters {
        context: browsingContext.BrowsingContext,
        timestamp: uint,
        url: text,
        userContext?: browser.UserContext,
    }

    export interface DownloadWillBeginParams extends browsingContext.BaseNavigationInfo {
        suggestedFilename: text,
    }

    export type DownloadEndParams = browsingContext.DownloadCanceledParams | browsingContext.DownloadCompleteParams;

    export interface DownloadCanceledParams extends browsingContext.BaseNavigationInfo {
        status: 'canceled',
    }

    export interface DownloadCompleteParams extends browsingContext.BaseNavigationInfo {
        status: 'complete',
        filepath: text | null,
    }

    export interface UserPromptClosedParameters {
        context: browsingContext.BrowsingContext,
        accepted: boolean,
        type: browsingContext.UserPromptType,
        userContext?: browser.UserContext,
        userText?: text,
    }

    export interface UserPromptOpenedParameters {
        context: browsingContext.BrowsingContext,
        handler: session.UserPromptHandlerType,
        message: text,
        type: browsingContext.UserPromptType,
        userContext?: browser.UserContext,
        defaultValue?: text,
    }

    export type Command = 
        | browsingContext.Activate
        | browsingContext.CaptureScreenshot
        | browsingContext.Close
        | browsingContext.Create
        | browsingContext.GetTree
        | browsingContext.HandleUserPrompt
        | browsingContext.LocateNodes
        | browsingContext.Navigate
        | browsingContext.Print
        | browsingContext.Reload
        | browsingContext.SetViewport
        | browsingContext.TraverseHistory;

    export type Result = 
        | browsingContext.ActivateResult
        | browsingContext.CaptureScreenshotResult
        | browsingContext.CloseResult
        | browsingContext.CreateResult
        | browsingContext.GetTreeResult
        | browsingContext.HandleUserPromptResult
        | browsingContext.LocateNodesResult
        | browsingContext.NavigateResult
        | browsingContext.PrintResult
        | browsingContext.ReloadResult
        | browsingContext.SetViewportResult
        | browsingContext.TraverseHistoryResult;

    export type Event = 
        | browsingContext.ContextCreated
        | browsingContext.ContextDestroyed
        | browsingContext.DomContentLoaded
        | browsingContext.DownloadEnd
        | browsingContext.DownloadWillBegin
        | browsingContext.FragmentNavigated
        | browsingContext.HistoryUpdated
        | browsingContext.Load
        | browsingContext.NavigationAborted
        | browsingContext.NavigationCommitted
        | browsingContext.NavigationFailed
        | browsingContext.NavigationStarted
        | browsingContext.UserPromptClosed
        | browsingContext.UserPromptOpened;

    export interface Activate {
        method: 'browsingContext.activate',
        params: browsingContext.ActivateParameters,
    }

    export type ActivateResult = EmptyResult;

    export interface CaptureScreenshot {
        method: 'browsingContext.captureScreenshot',
        params: browsingContext.CaptureScreenshotParameters,
    }

    export interface CaptureScreenshotResult {
        data: text,
    }

    export interface Close {
        method: 'browsingContext.close',
        params: browsingContext.CloseParameters,
    }

    export type CloseResult = EmptyResult;

    export interface Create {
        method: 'browsingContext.create',
        params: browsingContext.CreateParameters,
    }

    export interface CreateResult {
        context: browsingContext.BrowsingContext,
        userContext?: browser.UserContext,
    }

    export interface GetTree {
        method: 'browsingContext.getTree',
        params: browsingContext.GetTreeParameters,
    }

    export interface GetTreeResult {
        contexts: browsingContext.InfoList,
    }

    export interface HandleUserPrompt {
        method: 'browsingContext.handleUserPrompt',
        params: browsingContext.HandleUserPromptParameters,
    }

    export type HandleUserPromptResult = EmptyResult;

    export interface LocateNodes {
        method: 'browsingContext.locateNodes',
        params: browsingContext.LocateNodesParameters,
    }

    export interface LocateNodesResult {
        nodes: script.NodeRemoteValue[],
    }

    export interface Navigate {
        method: 'browsingContext.navigate',
        params: browsingContext.NavigateParameters,
    }

    export interface NavigateResult {
        navigation: browsingContext.Navigation | null,
        url: text,
    }

    export interface Print {
        method: 'browsingContext.print',
        params: browsingContext.PrintParameters,
    }

    export interface PrintResult {
        data: text,
    }

    export interface Reload {
        method: 'browsingContext.reload',
        params: browsingContext.ReloadParameters,
    }

    export type ReloadResult = browsingContext.NavigateResult;

    export interface SetViewport {
        method: 'browsingContext.setViewport',
        params: browsingContext.SetViewportParameters,
    }

    export type SetViewportResult = EmptyResult;

    export interface TraverseHistory {
        method: 'browsingContext.traverseHistory',
        params: browsingContext.TraverseHistoryParameters,
    }

    export type TraverseHistoryResult = EmptyResult;

    export interface ContextCreated {
        method: 'browsingContext.contextCreated',
        params: browsingContext.Info,
    }

    export interface ContextDestroyed {
        method: 'browsingContext.contextDestroyed',
        params: browsingContext.Info,
    }

    export interface DomContentLoaded {
        method: 'browsingContext.domContentLoaded',
        params: browsingContext.NavigationInfo,
    }

    export interface DownloadEnd {
        method: 'browsingContext.downloadEnd',
        params: browsingContext.DownloadEndParams,
    }

    export interface DownloadWillBegin {
        method: 'browsingContext.downloadWillBegin',
        params: browsingContext.DownloadWillBeginParams,
    }

    export interface FragmentNavigated {
        method: 'browsingContext.fragmentNavigated',
        params: browsingContext.NavigationInfo,
    }

    export interface HistoryUpdated {
        method: 'browsingContext.historyUpdated',
        params: browsingContext.HistoryUpdatedParameters,
    }

    export interface Load {
        method: 'browsingContext.load',
        params: browsingContext.NavigationInfo,
    }

    export interface NavigationAborted {
        method: 'browsingContext.navigationAborted',
        params: browsingContext.NavigationInfo,
    }

    export interface NavigationCommitted {
        method: 'browsingContext.navigationCommitted',
        params: browsingContext.NavigationInfo,
    }

    export interface NavigationFailed {
        method: 'browsingContext.navigationFailed',
        params: browsingContext.NavigationInfo,
    }

    export interface NavigationStarted {
        method: 'browsingContext.navigationStarted',
        params: browsingContext.NavigationInfo,
    }

    export interface UserPromptClosed {
        method: 'browsingContext.userPromptClosed',
        params: browsingContext.UserPromptClosedParameters,
    }

    export interface UserPromptOpened {
        method: 'browsingContext.userPromptOpened',
        params: browsingContext.UserPromptOpenedParameters,
    }
}

export namespace emulation {

    export interface SetForcedColorsModeThemeOverrideParameters {
        theme: emulation.ForcedColorsModeTheme | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export type ForcedColorsModeTheme = 'light' | 'dark';

    export interface SetGeolocationOverrideParameters {
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export type GeolocationCoordinates = any;

    export interface GeolocationPositionError {
        type: 'positionUnavailable',
    }

    export interface SetLocaleOverrideParameters {
        locale: text | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface SetNetworkConditionsParameters {
        networkConditions: emulation.NetworkConditions | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export type NetworkConditions = emulation.NetworkConditionsOffline;

    export interface NetworkConditionsOffline {
        type: 'offline',
    }

    export interface ScreenArea {
        width: uint,
        height: uint,
    }

    export interface SetScreenSettingsOverrideParameters {
        screenArea: emulation.ScreenArea | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export type ScreenOrientationNatural = 'portrait' | 'landscape';

    export type ScreenOrientationType = 
        | 'portrait-primary'
        | 'portrait-secondary'
        | 'landscape-primary'
        | 'landscape-secondary';

    export interface ScreenOrientation {
        natural: emulation.ScreenOrientationNatural,
        type: emulation.ScreenOrientationType,
    }

    export interface SetScreenOrientationOverrideParameters {
        screenOrientation: emulation.ScreenOrientation | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface SetUserAgentOverrideParameters {
        userAgent: text | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface SetScriptingEnabledParameters {
        enabled: false | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface SetScrollbarTypeOverrideParameters {
        scrollbarType: 'classic' | 'overlay' | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface SetTimezoneOverrideParameters {
        timezone: text | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface SetTouchOverrideParameters {
        maxTouchPoints: /* >= 1 */ uint | null,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export type Command = 
        | emulation.SetForcedColorsModeThemeOverride
        | emulation.SetGeolocationOverride
        | emulation.SetLocaleOverride
        | emulation.SetNetworkConditions
        | emulation.SetScreenOrientationOverride
        | emulation.SetScreenSettingsOverride
        | emulation.SetScriptingEnabled
        | emulation.SetScrollbarTypeOverride
        | emulation.SetTimezoneOverride
        | emulation.SetTouchOverride
        | emulation.SetUserAgentOverride;

    export type Result = 
        | emulation.SetForcedColorsModeThemeOverrideResult
        | emulation.SetGeolocationOverrideResult
        | emulation.SetLocaleOverrideResult
        | emulation.SetScreenOrientationOverrideResult
        | emulation.SetScriptingEnabledResult
        | emulation.SetScrollbarTypeOverrideResult
        | emulation.SetTimezoneOverrideResult
        | emulation.SetTouchOverrideResult
        | emulation.SetUserAgentOverrideResult;

    export interface SetForcedColorsModeThemeOverride {
        method: 'emulation.setForcedColorsModeThemeOverride',
        params: emulation.SetForcedColorsModeThemeOverrideParameters,
    }

    export type SetForcedColorsModeThemeOverrideResult = EmptyResult;

    export interface SetGeolocationOverride {
        method: 'emulation.setGeolocationOverride',
        params: emulation.SetGeolocationOverrideParameters,
    }

    export type SetGeolocationOverrideResult = EmptyResult;

    export interface SetLocaleOverride {
        method: 'emulation.setLocaleOverride',
        params: emulation.SetLocaleOverrideParameters,
    }

    export type SetLocaleOverrideResult = EmptyResult;

    export interface SetNetworkConditions {
        method: 'emulation.setNetworkConditions',
        params: emulation.SetNetworkConditionsParameters,
    }

    export type SetNetworkConditionsResult = EmptyResult;

    export interface SetScreenOrientationOverride {
        method: 'emulation.setScreenOrientationOverride',
        params: emulation.SetScreenOrientationOverrideParameters,
    }

    export type SetScreenOrientationOverrideResult = EmptyResult;

    export interface SetScreenSettingsOverride {
        method: 'emulation.setScreenSettingsOverride',
        params: emulation.SetScreenSettingsOverrideParameters,
    }

    export type SetScreenSettingsOverrideResult = EmptyResult;

    export interface SetScriptingEnabled {
        method: 'emulation.setScriptingEnabled',
        params: emulation.SetScriptingEnabledParameters,
    }

    export type SetScriptingEnabledResult = EmptyResult;

    export interface SetScrollbarTypeOverride {
        method: 'emulation.setScrollbarTypeOverride',
        params: emulation.SetScrollbarTypeOverrideParameters,
    }

    export type SetScrollbarTypeOverrideResult = EmptyResult;

    export interface SetTimezoneOverride {
        method: 'emulation.setTimezoneOverride',
        params: emulation.SetTimezoneOverrideParameters,
    }

    export type SetTimezoneOverrideResult = EmptyResult;

    export interface SetTouchOverride {
        method: 'emulation.setTouchOverride',
        params: emulation.SetTouchOverrideParameters,
    }

    export type SetTouchOverrideResult = EmptyResult;

    export interface SetUserAgentOverride {
        method: 'emulation.setUserAgentOverride',
        params: emulation.SetUserAgentOverrideParameters,
    }

    export type SetUserAgentOverrideResult = EmptyResult;
}

export namespace network {

    export interface AuthChallenge {
        scheme: text,
        realm: text,
    }

    export interface AuthCredentials {
        type: 'password',
        username: text,
        password: text,
    }

    export interface BaseParameters {
        context: browsingContext.BrowsingContext | null,
        isBlocked: boolean,
        navigation: browsingContext.Navigation | null,
        redirectCount: uint,
        request: network.RequestData,
        timestamp: uint,
        userContext?: browser.UserContext | null,
        intercepts?: /* >0 */ network.Intercept[],
    }

    export type BytesValue = network.StringValue | network.Base64Value;

    export interface StringValue {
        type: 'string',
        value: text,
    }

    export interface Base64Value {
        type: 'base64',
        value: text,
    }

    export type Collector = text;

    export type CollectorType = 'blob';

    export type SameSite = 
        | 'strict'
        | 'lax'
        | 'none'
        | 'default';

    // implementation defined non exhausitive
    export interface Cookie {
        name: text,
        value: network.BytesValue,
        domain: text,
        path: text,
        size: uint,
        httpOnly: boolean,
        secure: boolean,
        sameSite: network.SameSite,
        expiry?: uint,
    }

    export interface CookieHeader {
        name: text,
        value: network.BytesValue,
    }

    export type DataType = 'request' | 'response';

    export interface FetchTimingInfo {
        timeOrigin: float,
        requestTime: float,
        redirectStart: float,
        redirectEnd: float,
        fetchStart: float,
        dnsStart: float,
        dnsEnd: float,
        connectStart: float,
        connectEnd: float,
        tlsStart: float,
        requestStart: float,
        responseStart: float,
        responseEnd: float,
    }

    export interface Header {
        name: text,
        value: network.BytesValue,
    }

    export interface Initiator {
        columnNumber?: uint,
        lineNumber?: uint,
        request?: network.Request,
        stackTrace?: script.StackTrace,
        type?: 
            | 'parser'
            | 'script'
            | 'preflight'
            | 'other',
    }

    export type Intercept = text;

    export type Request = text;

    export interface RequestData {
        request: network.Request,
        url: text,
        method: text,
        headers: network.Header[],
        cookies: network.Cookie[],
        headersSize: uint,
        bodySize: uint | null,
        destination: text,
        initiatorType: text | null,
        timings: network.FetchTimingInfo,
    }

    export interface ResponseContent {
        size: uint,
    }

    export interface ResponseData {
        url: text,
        protocol: text,
        status: uint,
        statusText: text,
        fromCache: boolean,
        headers: network.Header[],
        mimeType: text,
        bytesReceived: uint,
        headersSize: uint | null,
        bodySize: uint | null,
        content: network.ResponseContent,
        authChallenges?: network.AuthChallenge[],
    }

    export interface SetCookieHeader {
        name: text,
        value: network.BytesValue,
        domain?: text,
        httpOnly?: boolean,
        expiry?: text,
        maxAge?: int,
        path?: text,
        sameSite?: network.SameSite,
        secure?: boolean,
    }

    export type UrlPattern = network.UrlPatternPattern | network.UrlPatternString;

    export interface UrlPatternPattern {
        type: 'pattern',
        protocol?: text,
        hostname?: text,
        port?: text,
        pathname?: text,
        search?: text,
    }

    export interface UrlPatternString {
        type: 'string',
        pattern: text,
    }

    export interface AddDataCollectorParameters {
        dataTypes: /* >0 */ network.DataType[],
        maxEncodedDataSize: uint,
        collectorType?: /* default blob */ network.CollectorType,
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface AddInterceptParameters {
        phases: /* >0 */ network.InterceptPhase[],
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        urlPatterns?: network.UrlPattern[],
    }

    export type InterceptPhase = 'beforeRequestSent' | 'responseStarted' | 'authRequired';

    export interface ContinueRequestParameters {
        request: network.Request,
        body?: network.BytesValue,
        cookies?: network.CookieHeader[],
        headers?: network.Header[],
        method?: text,
        url?: text,
    }

    export interface ContinueResponseParameters {
        request: network.Request,
        cookies?: network.SetCookieHeader[],
        credentials?: network.AuthCredentials,
        headers?: network.Header[],
        reasonPhrase?: text,
        statusCode?: uint,
    }

    export type ContinueWithAuthParameters =
        & network.ContinueWithAuthCredentials
        & network.ContinueWithAuthNoCredentials
        & {
        request: network.Request,
    }

    export interface ContinueWithAuthCredentials {
        action: 'provideCredentials',
        credentials: network.AuthCredentials,
    }

    export interface ContinueWithAuthNoCredentials {
        action: 'default' | 'cancel',
    }

    export interface DisownDataParameters {
        dataType: network.DataType,
        collector: network.Collector,
        request: network.Request,
    }

    export interface FailRequestParameters {
        request: network.Request,
    }

    export interface GetDataParameters {
        dataType: network.DataType,
        collector?: network.Collector,
        disown?: /* default false */ boolean,
        request: network.Request,
    }

    export interface ProvideResponseParameters {
        request: network.Request,
        body?: network.BytesValue,
        cookies?: network.SetCookieHeader[],
        headers?: network.Header[],
        reasonPhrase?: text,
        statusCode?: uint,
    }

    export interface RemoveDataCollectorParameters {
        collector: network.Collector,
    }

    export interface RemoveInterceptParameters {
        intercept: network.Intercept,
    }

    export interface SetCacheBehaviorParameters {
        cacheBehavior: 'default' | 'bypass',
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
    }

    export interface SetExtraHeadersParameters {
        headers: network.Header[],
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
    }

    export interface AuthRequiredParameters extends network.BaseParameters {
        response: network.ResponseData,
    }

    export interface BeforeRequestSentParameters extends network.BaseParameters {
        initiator?: network.Initiator,
    }

    export interface FetchErrorParameters extends network.BaseParameters {
        errorText: text,
    }

    export interface ResponseCompletedParameters extends network.BaseParameters {
        response: network.ResponseData,
    }

    export interface ResponseStartedParameters extends network.BaseParameters {
        response: network.ResponseData,
    }

    export type Command = 
        | network.AddDataCollector
        | network.AddIntercept
        | network.ContinueRequest
        | network.ContinueResponse
        | network.ContinueWithAuth
        | network.DisownData
        | network.FailRequest
        | network.GetData
        | network.ProvideResponse
        | network.RemoveDataCollector
        | network.RemoveIntercept
        | network.SetCacheBehavior
        | network.SetExtraHeaders;

    export type Result = 
        | network.AddDataCollectorResult
        | network.AddInterceptResult
        | network.ContinueRequestResult
        | network.ContinueResponseResult
        | network.ContinueWithAuthResult
        | network.DisownDataResult
        | network.FailRequestResult
        | network.GetDataResult
        | network.ProvideResponseResult
        | network.RemoveDataCollectorResult
        | network.RemoveInterceptResult
        | network.SetCacheBehaviorResult
        | network.SetExtraHeadersResult;

    export type Event = 
        | network.AuthRequired
        | network.BeforeRequestSent
        | network.FetchError
        | network.ResponseCompleted
        | network.ResponseStarted;

    export interface AddDataCollector {
        method: 'network.addDataCollector',
        params: network.AddDataCollectorParameters,
    }

    export interface AddDataCollectorResult {
        collector: network.Collector,
    }

    export interface AddIntercept {
        method: 'network.addIntercept',
        params: network.AddInterceptParameters,
    }

    export interface AddInterceptResult {
        intercept: network.Intercept,
    }

    export interface ContinueRequest {
        method: 'network.continueRequest',
        params: network.ContinueRequestParameters,
    }

    export type ContinueRequestResult = EmptyResult;

    export interface ContinueResponse {
        method: 'network.continueResponse',
        params: network.ContinueResponseParameters,
    }

    export type ContinueResponseResult = EmptyResult;

    export interface ContinueWithAuth {
        method: 'network.continueWithAuth',
        params: network.ContinueWithAuthParameters,
    }

    export type ContinueWithAuthResult = EmptyResult;

    export interface DisownData {
        method: 'network.disownData',
        params: network.DisownDataParameters,
    }

    export type DisownDataResult = EmptyResult;

    export interface FailRequest {
        method: 'network.failRequest',
        params: network.FailRequestParameters,
    }

    export type FailRequestResult = EmptyResult;

    export interface GetData {
        method: 'network.getData',
        params: network.GetDataParameters,
    }

    export interface GetDataResult {
        bytes: network.BytesValue,
    }

    export interface ProvideResponse {
        method: 'network.provideResponse',
        params: network.ProvideResponseParameters,
    }

    export type ProvideResponseResult = EmptyResult;

    export interface RemoveDataCollector {
        method: 'network.removeDataCollector',
        params: network.RemoveDataCollectorParameters,
    }

    export type RemoveDataCollectorResult = EmptyResult;

    export interface RemoveIntercept {
        method: 'network.removeIntercept',
        params: network.RemoveInterceptParameters,
    }

    export type RemoveInterceptResult = EmptyResult;

    export interface SetCacheBehavior {
        method: 'network.setCacheBehavior',
        params: network.SetCacheBehaviorParameters,
    }

    export type SetCacheBehaviorResult = EmptyResult;

    export interface SetExtraHeaders {
        method: 'network.setExtraHeaders',
        params: network.SetExtraHeadersParameters,
    }

    export type SetExtraHeadersResult = EmptyResult;

    export interface AuthRequired {
        method: 'network.authRequired',
        params: network.AuthRequiredParameters,
    }

    export interface BeforeRequestSent {
        method: 'network.beforeRequestSent',
        params: network.BeforeRequestSentParameters,
    }

    export interface FetchError {
        method: 'network.fetchError',
        params: network.FetchErrorParameters,
    }

    export interface ResponseCompleted {
        method: 'network.responseCompleted',
        params: network.ResponseCompletedParameters,
    }

    export interface ResponseStarted {
        method: 'network.responseStarted',
        params: network.ResponseStartedParameters,
    }
}

export namespace script {

    export type Channel = text;

    export interface ChannelValue {
        type: 'channel',
        value: script.ChannelProperties,
    }

    export interface ChannelProperties {
        channel: script.Channel,
        serializationOptions?: script.SerializationOptions,
        ownership?: script.ResultOwnership,
    }

    export interface EvaluateResultSuccess {
        type: 'success',
        result: script.RemoteValue,
        realm: script.Realm,
    }

    export interface EvaluateResultException {
        type: 'exception',
        exceptionDetails: script.ExceptionDetails,
        realm: script.Realm,
    }

    export interface ExceptionDetails {
        columnNumber: uint,
        exception: script.RemoteValue,
        lineNumber: uint,
        stackTrace: script.StackTrace,
        text: text,
    }

    export type Handle = text;

    export type InternalId = text;

    export type LocalValue = 
        | script.RemoteReference
        | script.PrimitiveProtocolValue
        | script.ChannelValue
        | script.ArrayLocalValue
        | script.DateLocalValue
        | script.MapLocalValue
        | script.ObjectLocalValue
        | script.RegExpLocalValue
        | script.SetLocalValue;

    export type ListLocalValue = script.LocalValue[];

    export interface ArrayLocalValue {
        type: 'array',
        value: script.ListLocalValue,
    }

    export interface DateLocalValue {
        type: 'date',
        value: text,
    }

    export type MappingLocalValue = [script.LocalValue | text, script.LocalValue][];

    export interface MapLocalValue {
        type: 'map',
        value: script.MappingLocalValue,
    }

    export interface ObjectLocalValue {
        type: 'object',
        value: script.MappingLocalValue,
    }

    export interface RegExpValue {
        pattern: text,
        flags?: text,
    }

    export interface RegExpLocalValue {
        type: 'regexp',
        value: script.RegExpValue,
    }

    export interface SetLocalValue {
        type: 'set',
        value: script.ListLocalValue,
    }

    export type PreloadScript = text;

    export type Realm = text;

    export type PrimitiveProtocolValue = 
        | script.UndefinedValue
        | script.NullValue
        | script.StringValue
        | script.NumberValue
        | script.BooleanValue
        | script.BigIntValue;

    export interface UndefinedValue {
        type: 'undefined',
    }

    export interface NullValue {
        type: 'null',
    }

    export interface StringValue {
        type: 'string',
        value: text,
    }

    export type SpecialNumber = 
        | 'NaN'
        | '-0'
        | 'Infinity'
        | '-Infinity';

    export interface NumberValue {
        type: 'number',
        value: number | script.SpecialNumber,
    }

    export interface BooleanValue {
        type: 'boolean',
        value: boolean,
    }

    export interface BigIntValue {
        type: 'bigint',
        value: text,
    }

    export type RealmInfo = 
        | script.WindowRealmInfo
        | script.DedicatedWorkerRealmInfo
        | script.SharedWorkerRealmInfo
        | script.ServiceWorkerRealmInfo
        | script.WorkerRealmInfo
        | script.PaintWorkletRealmInfo
        | script.AudioWorkletRealmInfo
        | script.WorkletRealmInfo;

    export interface BaseRealmInfo {
        realm: script.Realm,
        origin: text,
    }

    export interface WindowRealmInfo extends script.BaseRealmInfo {
        type: 'window',
        context: browsingContext.BrowsingContext,
        userContext?: browser.UserContext,
        sandbox?: text,
    }

    export interface DedicatedWorkerRealmInfo extends script.BaseRealmInfo {
        type: 'dedicated-worker',
        owners: [script.Realm],
    }

    export interface SharedWorkerRealmInfo extends script.BaseRealmInfo {
        type: 'shared-worker',
    }

    export interface ServiceWorkerRealmInfo extends script.BaseRealmInfo {
        type: 'service-worker',
    }

    export interface WorkerRealmInfo extends script.BaseRealmInfo {
        type: 'worker',
    }

    export interface PaintWorkletRealmInfo extends script.BaseRealmInfo {
        type: 'paint-worklet',
    }

    export interface AudioWorkletRealmInfo extends script.BaseRealmInfo {
        type: 'audio-worklet',
    }

    export interface WorkletRealmInfo extends script.BaseRealmInfo {
        type: 'worklet',
    }

    export type RealmType = 
        | 'window'
        | 'dedicated-worker'
        | 'shared-worker'
        | 'service-worker'
        | 'worker'
        | 'paint-worklet'
        | 'audio-worklet'
        | 'worklet';

    export type RemoteReference = script.SharedReference | script.RemoteObjectReference;

    // implementation defined non exhausitive
    export interface SharedReference {
        sharedId: script.SharedId,
        handle?: script.Handle,
    }

    // implementation defined non exhausitive
    export interface RemoteObjectReference {
        handle: script.Handle,
        sharedId?: script.SharedId,
    }

    export type RemoteValue = 
        | script.PrimitiveProtocolValue
        | script.SymbolRemoteValue
        | script.ArrayRemoteValue
        | script.ObjectRemoteValue
        | script.FunctionRemoteValue
        | script.RegExpRemoteValue
        | script.DateRemoteValue
        | script.MapRemoteValue
        | script.SetRemoteValue
        | script.WeakMapRemoteValue
        | script.WeakSetRemoteValue
        | script.GeneratorRemoteValue
        | script.ErrorRemoteValue
        | script.ProxyRemoteValue
        | script.PromiseRemoteValue
        | script.TypedArrayRemoteValue
        | script.ArrayBufferRemoteValue
        | script.NodeListRemoteValue
        | script.HTMLCollectionRemoteValue
        | script.NodeRemoteValue
        | script.WindowProxyRemoteValue;

    export type ListRemoteValue = script.RemoteValue[];

    export type MappingRemoteValue = [script.RemoteValue | text, script.RemoteValue][];

    export interface SymbolRemoteValue {
        type: 'symbol',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface ArrayRemoteValue {
        type: 'array',
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.ListRemoteValue,
    }

    export interface ObjectRemoteValue {
        type: 'object',
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.MappingRemoteValue,
    }

    export interface FunctionRemoteValue {
        type: 'function',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface RegExpRemoteValue extends script.RegExpLocalValue {
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface DateRemoteValue extends script.DateLocalValue {
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface MapRemoteValue {
        type: 'map',
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.MappingRemoteValue,
    }

    export interface SetRemoteValue {
        type: 'set',
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.ListRemoteValue,
    }

    export interface WeakMapRemoteValue {
        type: 'weakmap',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface WeakSetRemoteValue {
        type: 'weakset',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface GeneratorRemoteValue {
        type: 'generator',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface ErrorRemoteValue {
        type: 'error',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface ProxyRemoteValue {
        type: 'proxy',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface PromiseRemoteValue {
        type: 'promise',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface TypedArrayRemoteValue {
        type: 'typedarray',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface ArrayBufferRemoteValue {
        type: 'arraybuffer',
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface NodeListRemoteValue {
        type: 'nodelist',
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.ListRemoteValue,
    }

    export interface HTMLCollectionRemoteValue {
        type: 'htmlcollection',
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.ListRemoteValue,
    }

    export interface NodeRemoteValue {
        type: 'node',
        sharedId?: script.SharedId,
        handle?: script.Handle,
        internalId?: script.InternalId,
        value?: script.NodeProperties,
    }

    export interface NodeProperties {
        nodeType: uint,
        childNodeCount: uint,
        attributes?: any,
        children?: script.NodeRemoteValue[],
        localName?: text,
        mode?: 'open' | 'closed',
        namespaceURI?: text,
        nodeValue?: text,
        shadowRoot?: script.NodeRemoteValue | null,
    }

    export interface WindowProxyRemoteValue {
        type: 'window',
        value: script.WindowProxyProperties,
        handle?: script.Handle,
        internalId?: script.InternalId,
    }

    export interface WindowProxyProperties {
        context: browsingContext.BrowsingContext,
    }

    export type ResultOwnership = 'root' | 'none';

    export interface SerializationOptions {
        maxDomPath?: uint,
        maxObjectDepth?: uint,
        includeShadowTree?: 'none' | 'open' | 'all',
    }

    export type SharedId = text;

    export interface StackFrame {
        columnNumber: uint,
        functionName: text,
        lineNumber: uint,
        url: text,
    }

    export interface StackTrace {
        callFrames: script.StackFrame[],
    }

    export interface Source {
        realm: script.Realm,
        context?: browsingContext.BrowsingContext,
        userContext?: browser.UserContext,
    }

    export interface RealmTarget {
        realm: script.Realm,
    }

    export interface ContextTarget {
        context: browsingContext.BrowsingContext,
        sandbox?: text,
    }

    export type Target = script.ContextTarget | script.RealmTarget;

    export interface AddPreloadScriptParameters {
        functionDeclaration: text,
        arguments?: script.ChannelValue[],
        contexts?: /* >0 */ browsingContext.BrowsingContext[],
        userContexts?: /* >0 */ browser.UserContext[],
        sandbox?: text,
    }

    export interface DisownParameters {
        handles: script.Handle[],
        target: script.Target,
    }

    export interface CallFunctionParameters {
        functionDeclaration: text,
        awaitPromise: boolean,
        target: script.Target,
        arguments?: script.LocalValue[],
        resultOwnership?: script.ResultOwnership,
        serializationOptions?: script.SerializationOptions,
        this?: script.LocalValue,
        userActivation?: /* default false */ boolean,
    }

    export interface EvaluateParameters {
        expression: text,
        target: script.Target,
        awaitPromise: boolean,
        resultOwnership?: script.ResultOwnership,
        serializationOptions?: script.SerializationOptions,
        userActivation?: /* default false */ boolean,
    }

    export interface GetRealmsParameters {
        context?: browsingContext.BrowsingContext,
        type?: script.RealmType,
    }

    export interface RemovePreloadScriptParameters {
        script: script.PreloadScript,
    }

    export interface MessageParameters {
        channel: script.Channel,
        data: script.RemoteValue,
        source: script.Source,
    }

    export interface RealmDestroyedParameters {
        realm: script.Realm,
    }

    export type Command = 
        | script.AddPreloadScript
        | script.CallFunction
        | script.Disown
        | script.Evaluate
        | script.GetRealms
        | script.RemovePreloadScript;

    export type Result = 
        | script.AddPreloadScriptResult
        | script.CallFunctionResult
        | script.DisownResult
        | script.EvaluateResult
        | script.GetRealmsResult
        | script.RemovePreloadScriptResult;

    export type Event = script.Message | script.RealmCreated | script.RealmDestroyed;

    export interface AddPreloadScript {
        method: 'script.addPreloadScript',
        params: script.AddPreloadScriptParameters,
    }

    export interface AddPreloadScriptResult {
        script: script.PreloadScript,
    }

    export interface CallFunction {
        method: 'script.callFunction',
        params: script.CallFunctionParameters,
    }

    export type CallFunctionResult = script.EvaluateResult;

    export interface Disown {
        method: 'script.disown',
        params: script.DisownParameters,
    }

    export type DisownResult = EmptyResult;

    export interface Evaluate {
        method: 'script.evaluate',
        params: script.EvaluateParameters,
    }

    export type EvaluateResult = script.EvaluateResultSuccess | script.EvaluateResultException;

    export interface GetRealms {
        method: 'script.getRealms',
        params: script.GetRealmsParameters,
    }

    export interface GetRealmsResult {
        realms: script.RealmInfo[],
    }

    export interface RemovePreloadScript {
        method: 'script.removePreloadScript',
        params: script.RemovePreloadScriptParameters,
    }

    export type RemovePreloadScriptResult = EmptyResult;

    export interface Message {
        method: 'script.message',
        params: script.MessageParameters,
    }

    export interface RealmCreated {
        method: 'script.realmCreated',
        params: script.RealmInfo,
    }

    export interface RealmDestroyed {
        method: 'script.realmDestroyed',
        params: script.RealmDestroyedParameters,
    }
}

export namespace storage {

    // implementation defined non exhausitive
    export interface PartitionKey {
        userContext?: text,
        sourceOrigin?: text,
    }

    // implementation defined non exhausitive
    export interface CookieFilter {
        name?: text,
        value?: network.BytesValue,
        domain?: text,
        path?: text,
        size?: uint,
        httpOnly?: boolean,
        secure?: boolean,
        sameSite?: network.SameSite,
        expiry?: uint,
    }

    export interface BrowsingContextPartitionDescriptor {
        type: 'context',
        context: browsingContext.BrowsingContext,
    }

    // implementation defined non exhausitive
    export interface StorageKeyPartitionDescriptor {
        type: 'storageKey',
        userContext?: text,
        sourceOrigin?: text,
    }

    export type PartitionDescriptor = storage.BrowsingContextPartitionDescriptor | storage.StorageKeyPartitionDescriptor;

    export interface GetCookiesParameters {
        filter?: storage.CookieFilter,
        partition?: storage.PartitionDescriptor,
    }

    // implementation defined non exhausitive
    export interface PartialCookie {
        name: text,
        value: network.BytesValue,
        domain: text,
        path?: text,
        httpOnly?: boolean,
        secure?: boolean,
        sameSite?: network.SameSite,
        expiry?: uint,
    }

    export interface SetCookieParameters {
        cookie: storage.PartialCookie,
        partition?: storage.PartitionDescriptor,
    }

    export interface DeleteCookiesParameters {
        filter?: storage.CookieFilter,
        partition?: storage.PartitionDescriptor,
    }

    export type Command = storage.DeleteCookies | storage.GetCookies | storage.SetCookie;

    export type Result = storage.DeleteCookiesResult | storage.GetCookiesResult | storage.SetCookieResult;

    export interface DeleteCookies {
        method: 'storage.deleteCookies',
        params: storage.DeleteCookiesParameters,
    }

    export interface DeleteCookiesResult {
        partitionKey: storage.PartitionKey,
    }

    export interface GetCookies {
        method: 'storage.getCookies',
        params: storage.GetCookiesParameters,
    }

    export interface GetCookiesResult {
        cookies: network.Cookie[],
        partitionKey: storage.PartitionKey,
    }

    export interface SetCookie {
        method: 'storage.setCookie',
        params: storage.SetCookieParameters,
    }

    export interface SetCookieResult {
        partitionKey: storage.PartitionKey,
    }
}

export namespace log {

    export type Level = 
        | 'debug'
        | 'info'
        | 'warn'
        | 'error';

    export type Entry = log.GenericLogEntry | log.ConsoleLogEntry | log.JavascriptLogEntry;

    export interface BaseLogEntry {
        level: log.Level,
        source: script.Source,
        text: text | null,
        timestamp: uint,
        stackTrace?: script.StackTrace,
    }

    export interface GenericLogEntry extends log.BaseLogEntry {
        type: text,
    }

    export interface ConsoleLogEntry extends log.BaseLogEntry {
        type: 'console',
        method: text,
        args: script.RemoteValue[],
    }

    export interface JavascriptLogEntry extends log.BaseLogEntry {
        type: 'javascript',
    }

    export type Event = log.EntryAdded;

    export interface EntryAdded {
        method: 'log.entryAdded',
        params: log.Entry,
    }
}

export namespace input {

    export interface ElementOrigin {
        type: 'element',
        element: script.SharedReference,
    }

    export interface PerformActionsParameters {
        context: browsingContext.BrowsingContext,
        actions: input.SourceActions[],
    }

    export type SourceActions = 
        | input.NoneSourceActions
        | input.KeySourceActions
        | input.PointerSourceActions
        | input.WheelSourceActions;

    export interface NoneSourceActions {
        type: 'none',
        id: text,
        actions: input.NoneSourceAction[],
    }

    export type NoneSourceAction = input.PauseAction;

    export interface KeySourceActions {
        type: 'key',
        id: text,
        actions: input.KeySourceAction[],
    }

    export type KeySourceAction = input.PauseAction | input.KeyDownAction | input.KeyUpAction;

    export interface PointerSourceActions {
        type: 'pointer',
        id: text,
        parameters?: input.PointerParameters,
        actions: input.PointerSourceAction[],
    }

    export type PointerType = 'mouse' | 'pen' | 'touch';

    export interface PointerParameters {
        pointerType?: /* default mouse */ input.PointerType,
    }

    export type PointerSourceAction = 
        | input.PauseAction
        | input.PointerDownAction
        | input.PointerUpAction
        | input.PointerMoveAction;

    export interface WheelSourceActions {
        type: 'wheel',
        id: text,
        actions: input.WheelSourceAction[],
    }

    export type WheelSourceAction = input.PauseAction | input.WheelScrollAction;

    export interface PauseAction {
        type: 'pause',
        duration?: uint,
    }

    export interface KeyDownAction {
        type: 'keyDown',
        value: text,
    }

    export interface KeyUpAction {
        type: 'keyUp',
        value: text,
    }

    export interface PointerUpAction {
        type: 'pointerUp',
        button: uint,
    }

    export interface PointerDownAction extends input.PointerCommonProperties {
        type: 'pointerDown',
        button: uint,
    }

    export interface PointerMoveAction extends input.PointerCommonProperties {
        type: 'pointerMove',
        x: float,
        y: float,
        duration?: uint,
        origin?: input.Origin,
    }

    export interface WheelScrollAction {
        type: 'scroll',
        x: int,
        y: int,
        deltaX: int,
        deltaY: int,
        duration?: uint,
        origin?: /* default viewport */ input.Origin,
    }

    export interface PointerCommonProperties {
        width?: /* default 1 */ uint,
        height?: /* default 1 */ uint,
        pressure?: /* default 0 */ float,
        tangentialPressure?: /* default 0 */ float,
        twist?: /* default 0 */ /* 0..359 */ number,
        altitudeAngle?: /* default 0 */ /* 0..1.5707963267948966 */ number,
        azimuthAngle?: /* default 0 */ /* 0..6.283185307179586 */ number,
    }

    export type Origin = 'viewport' | 'pointer' | input.ElementOrigin;

    export interface ReleaseActionsParameters {
        context: browsingContext.BrowsingContext,
    }

    export interface SetFilesParameters {
        context: browsingContext.BrowsingContext,
        element: script.SharedReference,
        files: text[],
    }

    export interface FileDialogInfo {
        context: browsingContext.BrowsingContext,
        userContext?: browser.UserContext,
        element?: script.SharedReference,
        multiple: boolean,
    }

    export type Command = input.PerformActions | input.ReleaseActions | input.SetFiles;

    export type Result = input.PerformActionsResult | input.ReleaseActionsResult | input.SetFilesResult;

    export type Event = input.FileDialogOpened;

    export interface PerformActions {
        method: 'input.performActions',
        params: input.PerformActionsParameters,
    }

    export type PerformActionsResult = EmptyResult;

    export interface ReleaseActions {
        method: 'input.releaseActions',
        params: input.ReleaseActionsParameters,
    }

    export type ReleaseActionsResult = EmptyResult;

    export interface SetFiles {
        method: 'input.setFiles',
        params: input.SetFilesParameters,
    }

    export type SetFilesResult = EmptyResult;

    export interface FileDialogOpened {
        method: 'input.fileDialogOpened',
        params: input.FileDialogInfo,
    }
}

export namespace webExtension {

    export type Extension = text;

    export interface InstallParameters {
        extensionData: webExtension.ExtensionData,
    }

    export type ExtensionData = webExtension.ExtensionArchivePath | webExtension.ExtensionBase64Encoded | webExtension.ExtensionPath;

    export interface ExtensionPath {
        type: 'path',
        path: text,
    }

    export interface ExtensionArchivePath {
        type: 'archivePath',
        path: text,
    }

    export interface ExtensionBase64Encoded {
        type: 'base64',
        value: text,
    }

    export interface UninstallParameters {
        extension: webExtension.Extension,
    }

    export type Command = webExtension.Install | webExtension.Uninstall;

    export type Result = webExtension.InstallResult | webExtension.UninstallResult;

    export interface Install {
        method: 'webExtension.install',
        params: webExtension.InstallParameters,
    }

    export interface InstallResult {
        extension: webExtension.Extension,
    }

    export interface Uninstall {
        method: 'webExtension.uninstall',
        params: webExtension.UninstallParameters,
    }

    export type UninstallResult = EmptyResult;
}
