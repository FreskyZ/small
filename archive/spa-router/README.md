a correctly implemented single page application router

this is a client side router, not to be confused with server side routing,
this is especially correct for react applications which defacto use react-router,
at the time of developing this did not take server side routing into consideration

first, single page application and client side routing

- traditional websites reload the world when switching pages, all html/css/js is reloaded,
  html prototol is created or parsed, tcp and tls hand shaking is performed, html document and css files are parsed,
  javascript executing environment and sandbox is initialized, document object model is created, and many other things,
  many optimizations are designed and implemented to make this process faster, but not enough
- single page applications (SPA) solve the problem by using only one traditional web page, and load only necessary
  resource and data when switching and displaying on SPA page, sometimes it is only a data loading wihout any other
  loading of html/css/js/img, etc.
- to keep the original user experience to store some state in the url for sharing urls or saving bookmarks, SPAs also
  use url to determine which Content to render, but at client side with help from special url part (segment/hash part
  is not sent to server) or special server configuration (wildcard or regex route matching), the module or the library
  to handle url and url change works like server side router, so it is also called router
- furthur reading https://stackoverflow.com/a/37062379 https://en.wikipedia.org/wiki/Single-page_application

a router

- work with routing components, a routing component display different content, which appears as complete page content
  change or partial page content change, or at least change rendered children or execute some logic, according to some
  condition from component state. a routing component normally will display, manipulate, include controlling visiblity
  or enablement of a navigation item ui. a routing component don't necessary work with url state, but synchronize from
  and into url state should be as easy as calling sinle html api and clicking an navigation item
- provide leave confirmation functionality,
  which corresponds to traditional web page's "are you sure to leave" confirmation window before closing the page,
  note that it's not possible or practical to implement such functionality after you handed the lifetime of content
  components to a generic router library while that library don't provide such functionality, that you may still have
  a confirmation modal when a page component goes out of lifetime, but the routing state is already changed to the
  new page, that the volatile state in original page component is already gone and state in new component is already
  initialized and initialize effect is already fired, that you may use magic to prevent these from happening and change
  back to original page with original state, there may be feasible alternative solution, but that may be unreliable,
  unstable to library version update, and can mess up browser history (browser back and forward button not work)

this router,

- has very simple implementation based on html5 history api,
  https://developer.mozilla.org/en-US/docs/Web/API/History_API
  and even simpler if you have experience to learn and use react-router or something similar
- convert genericly typed browser location state from and to dedicated data structure for the particular application,
  which make state handling easier to implement and read, and prevent errors with the help of type checking
- is the only place in an application to listen to url state change, external changes may come from user manually
  change the url, open a bookmark or copy paste url, which should be helpful to debug

you will see react-router in exactly every react application, it is poorly maintained and has
incorrect designment, include the direct motivation of this router which is leave confirmation feature

- they change api frequently
  - v3 api: https://github.com/remix-run/react-router/blob/v3/docs/guides/ConfirmingNavigation.md
    this version was used in previous version of this application and works correctly, although
    it is not async and we use additional logic to always prevent navigation and redo navigation
    after user confirmation
  - v5 api: https://v5.reactrouter.com/core/api/Prompt
    this version changed all apis to component style, requiring all related source code changed or
    moved without upgrading of core routing functionalities, I'd assume there are additional "shining"
    new features added but they are not about routing
  - v6 api: https://reactrouter.com/en/dev/hooks/use-blocker,
    this is not on main branch at the time of writing,
    use this if the previous line does not work https://reactrouter.com/en/main/hooks/use-blocker
    (UPDATE: use v8 docs link if the previous line does not work https://reactrouter.com/api/hooks/useBlocker)
    this version changed all apis to hooks style, requiring all related
    source code changed or moved without upgrading of core routing functionalities, there are more
    additional shining new features added and they are definitely not about routing
  - v1 api if you'd like the list to be complete: https://github.com/remix-run/react-router/blob/v1/docs/API.md#lifecycle-mixin
    it uses the mixin function in very old version of react, and definitely require all related code changed
    after upgrading react to 16
- they do not provide the feature for very long time
  - https://github.com/remix-run/react-router/issues/8139 open in Oct 2021 and close in Jan 2023,
    during this time people use alternative solutions, there are many long comments in the issue and you don't
    know whose code is correct or fits your feature requirement or has acceptable implementation quality
  - they did not feel shame and collect the process in https://github.com/remix-run/react-router/blob/main/decisions/0001-use-blocker.md
    - they claim in the issue is not breaking change because the api is internal,
      regardless of they break all of the apis every major version and require application developers to do a lot of work
    - they claim it is preferrable to use localstorage pattern, which means you store state in localstorage and recover
      that later, this pattern is not acceptable because this changes user interaction logic, and it is not correct to
      store important or large chunk of data in localstorage, localstorage may be cleared by user or browser at any time,
      although some applications prefer put all state inside some state management library, but not all applications use
      this architecture, this indicates the maintainers do not actually use their library, as an application developer for
      a common application
    - they claim it is hard to implement reliably using browser history, providing strange user input like clicking go back
      again when waiting for confirmation modal, but not quite correct browser history is acceptable for most applications,
      sane users will change to use navigation menu, refresh page or use saved urls or bookmarks, they will not go to figure
      out exactly expected correct behavior and report there is a mismatch, actually it is always not possible or practical
      for a web page to handle issues inside browser outside of the web page, simillar to reading native files, determine
      browser window shape or change back panel color of their mobile phones, these disadvantages are well known and people
      still choose the browser for various reasons
    you really cannot call it a well maintained library if they stuck on minor and not possible edge cases and not providing
    widely required features in all previous versions
- they prefer browser history over hash history
  - UPDATE: the strong recommendation against hash history is removed in v7,
    this statement disappears with all v6 docs in https://github.com/remix-run/react-router/pull/11768 and v7 don't have them
  - the reason in not provided in v6 document
  - v5 document https://v5.reactrouter.com/web/api/HashRouter
    this claims hash history cannot use location.key and location.state, they are used in this program,
    they seems to want to simulate browser history's feature on hash history, but I cannot think up of or find any functionality
    requiring this feature, and this new router implementation proves that
    UPDATE: the history state is the history state, which means state bind to history, e.g. /product/:productid can store the
    number id in state, this feature is not needed in SPA because there is always only one history in one tab, you can directly
    store that in global variable, like this implementation
  - v3 document https://github.com/remix-run/react-router/blob/v3/docs/guides/Histories.md#hashhistory
    this claims old browser does not support html5 history api, that's not true, even safari support this in the year of 2010,
    way earlier than this version of react router or the react library, this also claims hash history not for server side rendering,
    but browser history is also not for server side rendering
  using location state indicates that they think history api is reliable, have predicatable back and forward behavior, and can store
  important state, which is not true, especially with browser mess up and restrict more and more things claiming that's for security
- there is another issue that they add handler to beforeunload event, and the window.confirm modal is always popped without asking
  you wehther it is needed, which is annoying when your application is ok to reload and breaks automation test runners, they are also
  not shameful to indicate this issue in https://github.com/remix-run/history/blob/dev/docs/blocking-transitions.md, they are even
  more not shameful to claim this makes some other features not work correctly, I have to hook window.addeventlistener to prevent
  this handler being added

the answer to some of the previous questions is at https://remix.run/docs/en/main/discussion/introduction

- react-router is part of the remix framework which claims itself a compiler + servier side http handler + server framework and
  browser framework, and the framework require react-router to add non routing related features like data loading or form submitting,
  they like to dream their dream of framework everything and does not pay actual attention to the routing functionality at client
  side, they don't know some web application developers does not have the previledge to require server side to be configured for
  browser history,
- there is recommendation for routing library when people talking about replacement of react-router, the tanstack router at
  https://tanstack.com/router/v1/docs/overview, but it also has the risk of developers dream of framework everything and forgets
  core routing functionality, see https://tanstack.com
- I'd assme the generic router library developers become INSANE after they manage lifetime of all the components and own all the
  components and start to want to own more and control more, but the poor maintanance of widely used library with this name is really
  a HARM to react ecosystem and they should feel GUILTY for that
- UPDATE remix v2 = react router v7, as told by ai when talking about the following event
- UPDATE remix v3 cancelled and there is no search result for "remix" in react router v8 document, now remix.run website is ai slop,
  this is actually as insane as you can expect when they want a full framework in old days and change to want to a full ai framework nowadays
