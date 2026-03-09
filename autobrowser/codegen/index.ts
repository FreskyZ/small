import fs from 'node:fs/promises';

// see https://github.com/webdriverio/webdriverio/blob/main/packages/wdio-protocols/src/protocols/webdriverBidi.ts
// and https://github.com/webdriverio/webdriverio/blob/main/scripts/bidi/index.ts
// generate type definitions from https://github.com/w3c/webdriver-bidi/blob/main/index.bs
// cddl syntax https://datatracker.ietf.org/doc/html/rfc8610

// stage 1. collect all <pre class="cddl">

const originalContent = await fs.readFile('codegen/spec.bs', 'utf-8');
const originalLines = originalContent.split('\n').map((r, i) => [r, i] as const);

const sections: { line: number, content: string }[] = [];
let beginIndex = -1; // >= means currently inside a <pre>, and the pre's rowindex is beginindex 
for (const [row, rowIndex] of originalLines) {
    if (beginIndex >= 0) {
        // assert no <pre> inside <pre class="cddl">, or else the </pre> end is incorrect
        if (row.includes("<pre")) {
            console.log(`line ${rowIndex + 1} unexpected <pre> inside <pre>`);
        }
        if (row.includes("</pre>")) {
            const content = originalLines.slice(beginIndex, rowIndex + 1).map(([r]) => r).join('\n');
            sections.push({ line: beginIndex, content });
            beginIndex = -1;
        }
    } else {
        if (row.trimStart().startsWith('<pre class="cddl"')) {
            beginIndex = rowIndex;
        }
    }
}

// stage 1 result: looks good
// await fs.writeFile('codegen/stage1.txt', sections.map(s => s.content).join('\n================================\n'));
const cddlContent = sections.map(s => s.content.split('\n').slice(1, -1).join('\n')).join('\n');
// await fs.writeFile('codegen/spec.cddl', cddlContent);

// stage 2. parse
// // nodejs package cddl and cddl2ts does not work immediately, so skip for now

// stage 2.1. separate types by "name = {...}, name = (...) or name = ...;"

// 2.1.1. exclude html comments, these comments are for document writers,
// not for spec readers, rendered spec does not have these contents, so can ignore here
let nccddl = cddlContent;
while (nccddl.includes('<!--')) {
    const beginPosition = nccddl.indexOf('<!--');
    const endPosition = nccddl.indexOf('-->');
    nccddl = nccddl.substring(0, beginPosition) + nccddl.substring(endPosition + 3);
}

// 2.1.2. ignore input.PointerCommonProperties.altitudeAngle and azimuthAngle and twist
// they are not used for now and currently only occurance of nested parenthesis
nccddl = nccddl.split('\n').filter(r => !r.includes('altitudeAngle') && !r.includes('azimuthAngle') && !r.includes('twist')).join('\n');
if (nccddl.endsWith('\n')) { nccddl += '\n'; }
// await fs.writeFile('codegen/specnc.cddl', nccddl);

// 2.1.3. actual collect
const typenames: { name: string, body: string, comments: string[] }[] = [];
let position = 0;
while (position < nccddl.length) {
    let head = nccddl.substring(position).trimStart();
    if (!head.length) { break; }

    let comments: string[] = undefined;
    while (head.startsWith(';')) {
        const lineEndPosition = head.indexOf('\n');
        (comments ??= []).push(head.substring(1, lineEndPosition));
        head = head.substring(lineEndPosition).trimStart();
    }

    const match1 = /^([\w-\.]+)/.exec(head);
    if (!match1) {
        console.log(`position ${nccddl.length - head.length} expect name, meet ${head.substring(0, 20)}`);
        break;
    }
    const name = match1[0];
    head = head.substring(name.length).trimStart();

    if (!head.startsWith("=")) {
        console.log(`type ${name} position ${nccddl.length - head.length} expect =, meet ${head.substring(0, 10)}`);
        break;
    }
    head = head.substring(1).trimStart();

    let body: string;
    if (head.startsWith('{')) {
        // handle nested brace
        let abort = false;
        let nestedLevel = 1; // nested level, or expect right brace count
        let currentPosition = 1;
        while (nestedLevel) {
            const nextEndPosition = head.indexOf('}', currentPosition);
            const nextBeginPosition = head.indexOf('{', currentPosition);
            if (nextEndPosition >= 0) {
                if (nextBeginPosition >= 0) {
                    if (nextBeginPosition < nextEndPosition) {
                        // normal nested brace pair
                        currentPosition = nextEndPosition + 1;
                    } else {
                        // reduce one nested level
                        nestedLevel -= 1;
                        // start next loop after nextend
                        currentPosition = nextEndPosition + 1;
                    }
                } else {
                    // no more next begin, this is near end of file
                    currentPosition = nextEndPosition + 1;
                    if (nestedLevel > 1) {
                        console.log(`type ${name} not closed left brace`);
                        abort = true;
                    }
                    break;
                }
            } else {
                console.log(`type ${name} not closed left brace`);
                abort = true;
                break;
            }
        }
        if (abort) { break; }
        body = head.substring(0, currentPosition);
    } else if (head.startsWith('(')) {
        const endPosition = head.substring(1).indexOf(')');
        const nextBeginPosition = head.substring(1).indexOf('(');
        if (nextBeginPosition >= 0 && nextBeginPosition < endPosition) {
            console.log(`type ${name} position ${nccddl.length - head.length} unexpected nested (, next ( at offset ${nextBeginPosition}, next ) at offset ${endPosition}`);
            break;
        }
        body = head.substring(0, endPosition + 2);
    } else {
        // for or type, e.g. A = "option1" / "option2" / "option3"
        // it may ends with semicolon, may ends with line end, if it is multiple line, non-ending line must end with /
        const lineEndPosition = head.indexOf('\n');
        const semicolonEndPosition = head.indexOf(';');
        if (semicolonEndPosition >= 0 && lineEndPosition >= 0 && semicolonEndPosition < lineEndPosition) {
            // normal semicolon end
            body = head.substring(0, semicolonEndPosition + 1);
        } else {
            if (lineEndPosition >= 0 && head.substring(0, lineEndPosition).trimEnd().endsWith('/')) {
                // multiple line, find next line not end with /
                const headLines = head.split('\n');
                const lineIndex = headLines.findIndex(r => !r.trimEnd().endsWith('/'));
                body = headLines.slice(0, lineIndex + 1).join('\n');
            } else if (lineEndPosition >= 0) {
                // normal line end
                body = head.substring(0, lineEndPosition);
            } else {
                // no lf position, this is reach eof
                body = head;
            }
        }
    }
    // console.log(`find ${name}`);
    typenames.push({ name, body, comments });
    head = head.substring(body.length).trimStart();
    position = nccddl.length - head.length;
}
// await fs.writeFile('codegen/spec-types.json', JSON.stringify(typenames));

// stage 2.2. parse type body

// 2.2.1. data structures
type PropertyType =
    | { kind: 'number' }
    | { kind: 'string' }
    | { kind: 'string-literal', value: string }
    | { kind: 'struct', ref: StructDecl }
    | { kind: 'enum', ref: EnumDecl }
    // [* for any length, [+ for >0 length
    | { kind: 'array', element: PropertyType, '>0': boolean }
    // reference to type maybe before definition of type, use this before finally resolved
    | { kind: 'ref', ref: string }

interface StructField {
    // field name may be omitted, that seems means spread
    name: string,
    type: PropertyType,
    optional: boolean,
    comments: string[],
}
interface StructDecl {
    // inline struct does not have name
    name: string,
    fields: StructField[],
    comments: string[],
}
// simply alias is enum with only one variant
interface EnumDecl {
    name: string,
    variants: PropertyType[],
    comments: string[],
}


// 2.2.2. parse type reference, return null for error
function parseTypeReference(typename: string, raw: string): PropertyType {
    raw = raw.trim();
    if (raw == 'text') {
        return { kind: 'string' };
    } else if (raw == 'js-int' || raw == 'js-uint') {
        return { kind: 'number' };
    } else if (raw.startsWith('"')) {
        if (!raw.startsWith('"')) {
            console.log(`type ${typename} referenced type ${raw} start with " but not end with ", how does that happen?`);
            return null;
        }
        return { kind: 'string-literal', value: raw.substring(1, raw.length - 2) };
    } else if (raw.startsWith('[')) {
        if (!raw.endsWith(']')) {
            console.log(`type ${typename} referenced type ${raw} start with [ but not end with ], how does that happen?`);
            return null;
        }
        if (raw[1] == '+') {
            const elementType = parseTypeReference(typename, raw.substring(2, raw.length - 3));
            return { kind: 'array', element: elementType, '>0': true };
        } else if (raw[1] == '*') {
            const elementType = parseTypeReference(typename, raw.substring(2, raw.length - 3));
            return { kind: 'array', element: elementType, '>0': false };
        } else {
            // TODO manually handle not [+ and [* arrays
        }
    } else {
        const match1 = /^([\w\.]+)$/.exec(raw);
        if (match1) {
            return { kind: 'ref', ref: raw };
        } else {
            console.log(`type ${typename} referenced type ${raw} unknown syntax`);
            return null;
        }
    }
}

const log1: string[] = [];
// this array only contains struct or enum
const declarations: PropertyType[] = [];
for (const stage21typename of typenames) {
    const { name: typename } = stage21typename;
    let body = stage21typename.body;
    const comments = stage21typename.comments ?? [];
    // ignore js-int, js-uint and Extensible
    if (['js-int', 'js-uint', 'Extensible'].includes(typename)) { continue; }

    // manually handle nested and multiple line inline struct types
    if (typename == 'session.NewResult') {
        log1.push(`struct ${typename}`);
        // nested session not used for now, make it only one sessionId field
        log1.push(`  field: sessionId: text`);
        comments.push(`there is another property capabilities which is very important in session.new command`);
        comments.push(`but this type is not used in the session.new call and is complex to handle so skip for now`);
        continue;
    } else if (typename == 'browsingContext.AccessibilityLocator') {
        log1.push(`struct ${typename}`);
        // { type: 'accessibility', value: { name?: string, role?: string } }
        log1.push(`  field: type: "accessibility"`);
        log1.push(`  field: value: { name?: string, role?: string }`);
        continue;
    } else if (typename == 'browsingContext.ContextLocator') {
        log1.push(`struct ${typename}`);
        // { type: 'context', value: { context: browsingContext.BrowsingContext } }
        log1.push(`  field: type: "context"`);
        log1.push(`  field: value: { context: string }`);
        continue;
    } else if (typename == 'input.PointerCommonProperties') {
        comments.push(`there is other properties twist, altitudeAngle and azimuthAngle`);
        comments.push(`they are not used for now, this type is not important for now, so skip`);
    } else if (typename == 'browser.DownloadBehavior' || typename == 'browsingContext.DownloadEndParams') {
        // why is this paren nested inside brance?
        body = body.split('\n').slice(1, -1).join('\n');
    } else if (typename == 'script.ListLocalValue') {
        declarations.push({ kind: 'array', element: { kind: 'ref', ref: 'script.LocalValue'}, '>0': false });
        continue;
    } else if (typename == 'script.MappingLocalValue') {
        // Map<Object | string, Object>, ignore member for now
        declarations.push({ kind: 'struct', ref: { name: 'script.MappingLocalValue', fields: [], comments: [] } });
        continue;
    } else if (typename == 'script.ListRemoteValue') {
        declarations.push({ kind: 'array', element: { kind: 'ref', ref: 'script.RemoteValue'}, '>0': false });
        continue;
    } else if (typename == 'script.MappingRemoteValue') {
        // Map<Object | string, Object>, ignore member for now
        declarations.push({ kind: 'struct', ref: { name: typename, fields: [], comments: [] } });
        continue;
    } else if (typename == 'emulation.SetGeolocationOverrideParameters') {
        // what's the syntax?
        declarations.push({ kind: 'struct', ref: { name: typename, fields: [], comments: [] } });
        continue;
    }

    const bodyLines = body.split('\n').map(b => b.trim());
    // both {} and () can have struct or enum, check by body[1]'s ending
    if (bodyLines[0] == '{' || bodyLines[0] == '(') {
        const endingQuote = bodyLines[0] == '{' ? '}' : ')';
        if (bodyLines.at(-1) != endingQuote) {
            console.log(`type ${typename} start with ${bodyLines[0]} but not end with ${endingQuote}`);
            continue;
        }
        const kind = bodyLines[1].endsWith('/') ? 'enum' : 'struct';
        if (kind == 'enum') {
            log1.push(`enum ${typename}`);
            const variants: PropertyType[] = [];
            const postfix = bodyLines[1].endsWith('//') ? '//' : '/';
            for (let index = 1; index < bodyLines.length - 1; index += 1) {
                let rawVariant = bodyLines[index];
                if (index == 1) {
                    rawVariant = rawVariant.substring(0, rawVariant.length - postfix.length).trim();
                } else if (index == bodyLines.length - 2) {
                    if (rawVariant.endsWith('/')) {
                        console.log(`type ${typename} variant#${index} why are you ending with / at last line?`);
                        // this does not abort
                    }
                } else {
                    const thisPostfix = rawVariant.endsWith('//') ? '//' : '/';
                    if (postfix != thisPostfix) {
                        console.log(`type ${typename} variant#${index} inconsistent separator this ${thisPostfix} original ${postfix}`);
                        // this does not abort
                    }
                    rawVariant = rawVariant.substring(0, rawVariant.length - postfix.length).trim();
                }
                // skip these 2 strange inline struct with field name omitted,
                // which directly means reference the field type, { script.DateLocalValue } should directly means script.DateLocalValue
                if (rawVariant == '{ script.DateLocalValue }' || rawVariant == '{ script.RegExpLocalValue }') {
                    rawVariant = rawVariant.substring(1, rawVariant.length - 2).trim();
                }

                const variantType = parseTypeReference(typename, rawVariant);
                if (variantType) {
                    variants.push(variantType);
                    log1.push(`  variant: ${JSON.stringify(variantType)}`);
                } else {
                    log1.push(`  !!!error variant: ${rawVariant}`);
                }
            }
            declarations.push({ kind: 'enum', ref: { name: typename, variants, comments }});
        } else {
            log1.push(`struct ${typename}`);
            const fields: StructField[] = [];
            for (let rawField of bodyLines.slice(1, -1)) {
                if (!rawField.length) { continue; } // what's this empty line?
                if (rawField.endsWith(',')) {
                    rawField = rawField.substring(0, rawField.length - 1).trim();
                }
                // log1.push(`  field: ${rawField}`);
                let optional = false;
                if (rawField.startsWith('?')) {
                    optional = true;
                    rawField = rawField.substring(1).trim();
                }
                if (typename == 'script.NodeProperties' && rawField.startsWith('attributes: ')) {
                    // skip inline map {* syntax for now
                    log1.push(`  ${optional ? 'optional ' : ''}field: attributes: Record<string, string>`);
                    fields.push({ name: 'attributes', optional, type: { kind: 'ref', ref: 'Record<string, string>' }, comments: [] })
                    continue;
                }
                if (rawField == 'Extensible') {
                    log1.push(`  field: non-exhausitive`);
                    comments.push('implementation defined non exhausitive');
                    continue;
                }

                let fieldname: string = null;
                const match1 = /^(\w+):/.exec(rawField);
                if (match1) {
                    fieldname = match1[1];
                    rawField = rawField.substring(fieldname.length + 1).trim();
                }

                const fieldType = parseTypeReference(`${typename} field ${fieldname ?? '(...)'}`, rawField);
                if (!fieldType) {
                    continue;
                } else {
                    fields.push({ name: fieldname, type: fieldType, optional, comments: [] })
                    log1.push(`  field ${fieldname ?? '(...)'}${optional ? '?' : ''}: ${JSON.stringify(fieldType)}`);
                }
            }
            declarations.push({ kind: 'struct', ref: { name: typename, fields, comments } });
        }
    } else {
        // merge multiple-line and no-paren enum into one line
        const rawVariants = bodyLines.join(' ').split('/').map(v => v.trim());
        log1.push(`enum ${typename}`);
        const variants: PropertyType[] = [];
        for (let rawVariant of rawVariants) {
            if (rawVariant.endsWith(';')) {
                rawVariant = rawVariant.substring(0, rawVariant.length - 1);
            }
            const variantType = parseTypeReference(typename, rawVariant);
            if (variantType) {
                variants.push(variantType);
                log1.push(`  variant: ${JSON.stringify(variantType)}`);
            } else {
                log1.push(`  !!!error variant: ${rawVariant}`);
            }
        }
        declarations.push({ kind: 'enum', ref: { name: typename, variants, comments }});
    }
}

await fs.writeFile('codegen/log1.txt', log1.join('\n'));

