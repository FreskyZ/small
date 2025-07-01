/** @jsxImportSource @emotion/react */
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { css } from '@emotion/react';
import * as I from './api.js';

const notificationElement = document.querySelector<HTMLSpanElement>('span#notification');

let notificationTimer: any;
function notification(message: string) {
    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }
    notificationElement.style.display = 'inline';
    notificationElement.innerText = message;
    notificationTimer = setTimeout(() => {
        notificationElement.style.display = 'none';
    }, 5000);
}

// // TODO MultiSelectDropdown.jsx
// import React, { useState, useRef, useEffect } from "react";

// const options = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

// export default function MultiSelectDropdown() {
//   const [selected, setSelected] = useState([]);
//   const [open, setOpen] = useState(false);
//   const dropdownRef = useRef(null);

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     function handleClickOutside(event) {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setOpen(false);
//       }
//     }
//     document.addEventListener("mousedown", handleClickOutside);
//     return () => document.removeEventListener("mousedown", handleClickOutside);
//   }, []);

//   const toggleOption = (option) => {
//     setSelected((prev) =>
//       prev.includes(option)
//         ? prev.filter((item) => item !== option)
//         : [...prev, option]
//     );
//   };

//   return (
//     <div ref={dropdownRef} style={{ position: "relative", width: 200 }}>
//       <div
//         style={{
//           border: "1px solid #ccc",
//           padding: "8px",
//           cursor: "pointer",
//           borderRadius: 4,
//           background: "#fff",
//         }}
//         onClick={() => setOpen((o) => !o)}
//       >
//         {selected.length === 0 ? "Select options" : selected.join(", ")}
//       </div>
//       {open && (
//         <div
//           style={{
//             position: "absolute",
//             top: "110%",
//             left: 0,
//             right: 0,
//             border: "1px solid #ccc",
//             background: "#fff",
//             borderRadius: 4,
//             zIndex: 1000,
//             maxHeight: 150,
//             overflowY: "auto",
//           }}
//         >
//           {options.map((option) => (
//             <label
//               key={option}
//               style={{
//                 display: "block",
//                 padding: "8px",
//                 cursor: "pointer",
//                 background: selected.includes(option) ? "#e6f7ff" : "#fff",
//               }}
//             >
//               <input
//                 type="checkbox"
//                 checked={selected.includes(option)}
//                 onChange={() => toggleOption(option)}
//                 style={{ marginRight: 8 }}
//               />
//               {option}
//             </label>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }


function App() {
    const styles = pageStyles;

    // ATTENTION for now flat display and use the items, implement later
    // const [_rootDirectory, setRootDirectory] = useState<I.SessionDirectory>({ id: 0, name: '', directories: [], sessions: [] });
    const [lookupSessions, setLookupSessions] = useState<I.LookupSession[]>([]);
    // const [sessionId, setSessionId] = useState(0); // 0 for new session
    const [currentSession, setCurrentSession] = useState<I.Session>(null);
    const [versionNumber, setVersionNumber] = useState(1);

    useEffect(() => {
        (async () => {
            // const response = await fetch(`https://api.example.com/chat/v1/sessions`, { headers: getAuthorizationHeader() });
            // const root: I.SessionDirectory = await response.json();
            // const flatSessions: I.LookupSession[] = [];
            // function collectFlatSessions(directory: I.SessionDirectory) {
            //     for (const subdirectory of directory.directories) {
            //         collectFlatSessions(subdirectory);
            //     }
            //     flatSessions.push(...directory.sessions);
            // }
            // collectFlatSessions(root);
            // setLookupSessions(flatSessions);
        })();
    }, []);

    const messages = currentSession ? currentSession.versions.find(v => v.version == versionNumber).messages : [];
    return <div css={css({ width: '100vw' })}>
        <div css={styles.sessionContainer}>
            <div css={styles.sessionContainerHeader}>
                {currentSession && <select value={versionNumber} onChange={e => setVersionNumber(Number(e.target.value))}>
                    {currentSession.versions.map(v => <option key={v.version} value={v.version}>V{v.version}</option>)}
                </select>}
            </div>
            {messages.map((m, i) => <div key={i} css={styles.messageContainer}>
                <span>{m.role}</span>
                <pre>{m.content}</pre>
            </div>)}
            <div css={styles.messageContainer}>
            </div>
        </div>
    </div>;
}
const pageStyles = {
    tree: css({
        label: 'tree',
        float: 'left',
        height: 'calc(100vh - 50px)',
        width: '220px',
        // TODO
        '@media (max-width: 600px)': {

        },
    }),
    sessionContainer: css({
        label: 'session-container',
        float: 'left',
        height: 'calc(100vh - 50px)',
    }),
    sessionContainerHeader: css({

    }),
    messageContainer: css({
    }),
};

createRoot(document.querySelector('main')).render(<App />);
