
// app name is YANO, db name is YANO, host is note.example.com
// the full-flat tag based note list seems too flat for a note, the tree structure seems complicated,
// I may try to use a fixed tree structure, e.g. book => section => page, which is same as onenote

// the book => section => page selection part have to be an overlay on mobile page
// in that case, I'd like to make yala's session list also overlay on mobile page, also session info overlay,
// while keep normal sidebar on pc page

// note need auto save
// preview page is a side view on pc page, and a switch button on mobile page
// preview content is always saved content
// need history management, consider auto history (every save) and manual named history

// note content is one markdown document
// it supports basic formatting, tables, external links
// and special external links to my drive's file, audio and video
// it supports share like note.freskyz.com/share/shareid in readonly mode

// for now the chat.example.com/\d+ seems kind of not ok, and conflict with chat.example.com/404
// consider using note.example.com?id=\d+, and note.example.com/s?id=guid

// code highlight maybe need this https://highlightjs.org/, if markdown library does not support syntax highlighting
