import fs from 'node:fs/promises';

// see https://github.com/webdriverio/webdriverio/blob/main/packages/wdio-protocols/src/protocols/webdriverBidi.ts
// and https://github.com/webdriverio/webdriverio/blob/main/scripts/bidi/index.ts
// generate type definitions from https://github.com/w3c/webdriver-bidi/blob/main/index.bs
// cddl syntax https://datatracker.ietf.org/doc/html/rfc8610

// stage 1. collect all <pre class="cddl">

const originalContent = await fs.readFile('codegen/spec.bs', 'utf-8');
const originalLines = originalContent.split('\n').map((r, i) => [r, i] as const);

let beginIndex = -1; // >=0 means currently inside a <pre>, and the pre's rowindex is beginindex
const cddlElements: { line: number, content: string }[] = [];
for (const [row, rowIndex] of originalLines) {
    if (beginIndex >= 0) {
        // assert no <pre> inside <pre class="cddl">, or else the </pre> end is incorrect
        if (row.includes("<pre")) {
            console.log(`line ${rowIndex + 1} unexpected <pre> inside <pre>`);
        }
        if (row.includes("</pre>")) {
            const rows = originalLines.slice(beginIndex, rowIndex + 1).map(([r]) => r);
            // reduce common indent
            const minIndent = rows.reduce((acc, r, i) =>
                // ignore empty line
                r.trim().length == 0 ? acc
                // ignore first line and last line (<pre> and </pre>)
                : i == 0 || i == rows.length - 1 ? acc
                : Math.min(acc, r.length - r.trimStart().length), 100);
            const trimmedContent = rows.map(r => r.substring(minIndent)).join('\n');
            cddlElements.push({ line: beginIndex, content: trimmedContent });
            beginIndex = -1;
        }
    } else {
        if (row.trimStart().startsWith('<pre class="cddl"')) {
            beginIndex = rowIndex;
        }
    }
}

const cddlOriginalContent = cddlElements.map(s => s.content.split('\n').slice(1, -1).join('\n')).join('\n');

// exclude html comments, these comments are for document writers,
// not for spec readers, rendered spec does not have these contents, so can ignore here
let cddlContent = cddlOriginalContent;
while (cddlContent.includes('<!--')) {
    const beginPosition = cddlContent.indexOf('<!--');
    const endPosition = cddlContent.indexOf('-->');
    cddlContent = cddlContent.substring(0, beginPosition) + cddlContent.substring(endPosition + 3);
}

cddlContent = cddlContent
    // meaningless to parse this
    .replace('{*text => text}', 'any')
    // meaningless to parse this
    // tell me why this can be parenthesis
    .replace('(*text => any)', 'any')
    // a spread member can be a variant, which is beyond current syntax design,
    // for this case, regard these variants as separate spread member works same in result typescript
    .replace(
        '(browser.ClientWindowNamedState // browser.ClientWindowRectState)',
        'browser.ClientWindowNamedState\n  browser.ClientWindowRectState')
    // completely don't understand what's this type definition doing, can you write something that can be expressed in normal languages?
    .replace('(\n    (coordinates: emulation.GeolocationCoordinates / null) //\n    (error: emulation.GeolocationPositionError)\n  ),', '')
    // same as that client window
    .replace(
        '(network.ContinueWithAuthCredentials // network.ContinueWithAuthNoCredentials)',
        'network.ContinueWithAuthCredentials\n  network.ContinueWithAuthNoCredentials');

// the correct way to handle this horific and completely useless type is skip
const wtftypeIndex = cddlContent.indexOf('emulation.GeolocationCoordinates = {');
const wtftypeEndIndex = cddlContent.indexOf('}', wtftypeIndex + 40);
cddlContent = cddlContent.substring(0, wtftypeIndex) +
    'emulation.GeolocationCoordinates = any' + cddlContent.substring(wtftypeEndIndex + 1);

// this seems to be possibly important recently
const wtftype2Index = cddlContent.indexOf('script.SerializationOptions = {');
const wtftype2EndIndex = cddlContent.indexOf('}', wtftype2Index + 40);
cddlContent = cddlContent.substring(0, wtftype2Index) +
    'script.SerializationOptions = { ?maxDomPath: js-uint, ?maxObjectDepth: js-uint, ?includeShadowTree: "none" / "open" / "all" }' +
    cddlContent.substring(wtftype2EndIndex + 1);

await fs.writeFile('codegen/spec.cddl', cddlContent);

// stage 2. parse
// // nodejs package cddl and cddl2ts does not work immediately, so skip for now

// unify enum's // and / to single /
// for now, => is the only 2 char separator
type Separator = '=' | '{' | '}' | '(' | ')' | ':' | '[' | ']' | '*' | '+' | ',' | '/' | '?' | '=>' | '..';
const AllSeparators1: Separator[] = ['=', '{', '}', '(', ')', ':', '[', ']', '*', '+', ',', '/', '?'];
const AllSeparators2: Separator[] = ['=>', '..', '//' as Separator];

interface SeparatorToken {
    kind: 'separator',
    value: Separator,
}
interface BoolToken {
    kind: 'bool',
    value: boolean,
}
interface NumberToken {
    kind: 'number',
    value: number,
}
interface StringToken {
    kind: 'string',
    value: string,
}
type TagName = '.default' | '.gt' | '.ge' | '.lt' | '.le';
const TagNames: TagName[] = ['.default', '.ge', '.gt', '.le', '.lt'];
interface TagToken {
    kind: 'tag',
    value: TagName,
}
interface NameToken {
    kind: 'name',
    value: string,
}
interface CommentToken {
    kind: 'comment',
    value: string,
}
type Token = SeparatorToken | BoolToken | NumberToken | StringToken | NameToken | TagToken | CommentToken;
type TokenPosition = Token & {
    byteIndex: number,
}
function displayToken(token: TokenPosition): string {
    if (token.kind == 'separator') { return `sep '${token.value}'`; }
    else if (token.kind == 'bool') { return token.value ? 'bool true' : 'bool false'; }
    else if (token.kind == 'number') { return `number ${token.value}`; }
    else if (token.kind == 'string') { return `string '${token.value}'`; }
    else if (token.kind == 'name') { return `name '${token.value}'`; }
    else if (token.kind == 'comment') { return 'comment'; }
}

function tokenize(raw: string): TokenPosition[] {
    const tokens: TokenPosition[] = [];

    let position = 0;
    while (position < raw.length) {
        // skip whitespace
        while (position < raw.length && /\s/.test(raw[position])) {
            position++;
        }
        if (position >= raw.length) { break; }
    
        const start = position;
        const ch = raw[position];
        if (ch == ';') {
            // comment
            let end = position;
            while (end < raw.length && raw[end] != '\n') { end++; }
            const value = raw.substring(position, end);
            tokens.push({ kind: 'comment', value, byteIndex: position });
            position = end;
        } else if (ch == '"') {
            // string literal
            position++;
            let end = position;
            while (end < raw.length && raw[end] != '"') { end++; }
            if (end >= raw.length) {
                throw new Error(`Unterminated string at ${position}`);
            }
            const value = raw.substring(position, end);
            tokens.push({ kind: 'string', value, byteIndex: start });
            position = end + 1;
        } else if (ch == '-' || /\d/.test(ch)) {
            // number literal
            let end = position;
            if (ch == '-') { end++; }
            while (end < raw.length && /\d/.test(raw[end])) { end++; }
            // number literal cannot end with '.', need look ahead 1
            if (end + 1 < raw.length && raw[end] == '.' && /\d/.test(raw[end + 1])) {
                end++;
                while (end < raw.length && /\d/.test(raw[end])) { end++; }
            }
            const valueStr = raw.substring(position, end);
            const value = parseFloat(valueStr);
            tokens.push({ kind: 'number', value, byteIndex: start });
            position = end;
        } else if (raw.startsWith('true', position)) {
            // true
            tokens.push({ kind: 'bool', value: true, byteIndex: position });
            position += 4;
        } else if (raw.startsWith('false', position)) {
            // false
            tokens.push({ kind: 'bool', value: false, byteIndex: position });
            position += 5;
        } else if (TagNames.some(n => raw.substring(position).startsWith(n))) {
            // tag
            const value = TagNames.find(n => raw.substring(position).startsWith(n));
            tokens.push({ kind: 'tag', value, byteIndex: position });
            position += value.length;
        } else if (AllSeparators2.some(s => raw.substring(position).startsWith(s))) {
            // NOTE sperator part before name, or else '..' is a name
            // separator 2
            const value: Separator = raw.substring(position).startsWith('//') ? '/' : raw.substring(position, position + 2) as Separator;
            tokens.push({ kind: 'separator', value, byteIndex: position });
            position += 2;
        } else if (AllSeparators1.includes(ch as Separator)) {
            // separator 1
            tokens.push({ kind: 'separator', value: ch as Separator, byteIndex: position });
            position++;
        } else if (/[\w\.]/.test(ch)) {
            // name
            let end = position;
            while (end < raw.length && /[\w\-\.]/.test(raw[end])) { end++ };
            const value = raw.substring(position, end);
            tokens.push({ kind: 'name', value, byteIndex: start });
            position = end;
        } else {
            // unknown
            throw new Error(`Unknown character '${ch}' at position ${position}`);
        }
        // if (tokens.length) { console.log(tokens.at(-1)); }
    }
    return tokens;
}

// spec = type-def*
// type-def = name '=' (struct-body | enum-body)
// struct-body = ('{' | '(') (field-def (',' | ';')?)* (')' | '}')
// // missing field name is a spread member (should be represented as a extend in typescript)
// // spread member type ref must be a single name
// field-def = '?'? (name ':')? type-ref
// // this looks kind of prune to conflict, but actually after a type-ref if there is a name that means end
// enum-body = ('{' | '(')? type-ref ('/' '/'? type-ref)* (')' | '}')? ';'?
// // a type-ref start with a name can only continue with / (this is the follow set)
// type-ref = name | string
//     | array-type-ref | tuple-type-ref | map-type-ref | number-range-ref
//     | enum-body | struct-body | type-ref (tag value)?
// array-type-ref = '[' ('*' | '+') type-ref ']'
// tuple-type-ref = '[' type-ref (',' type-ref)* ']'
// // map-type-ref = no, skip by manually change to any
// number-range-ref = number '..' number
// tag = '.default' | '.gt' | '.ge' | '.lt' | '.le'
// value = bool | number | string

interface NameRef {
    kind: 'name',
    value: string,
    byteIndex: number,
}
interface StringLitRef {
    kind: 'string',
    value: string,
    byteIndex: number,
}
interface BoolLitRef {
    kind: 'bool',
    value: boolean,
    byteIndex: number,
}
interface ArrayRef {
    kind: 'array',
    '>0': boolean,
    element: TypeRef,
    byteIndex: number,
}
interface TupleRef {
    kind: 'tuple',
    elements: TypeRef[],
    byteIndex: number,
}
interface RangeRef {
    kind: 'range',
    left: number,
    right: number,
    byteIndex: number,
}
type TypeRef =
    | NameRef
    | ArrayRef
    | TupleRef
    | RangeRef
    | StringLitRef
    | BoolLitRef
    | EnumBody
    | StructBody

interface Tag {
    tag: TagName,
    value: BoolToken | NumberToken | StringToken,
    byteIndex: number,
}

type TaggedTypeRef = TypeRef & {
    tags: Tag[],
    byteIndex: number,
}

interface EnumBody {
    kind: 'enum',
    variants: TaggedTypeRef[],
    byteIndex: number,
}
interface StructField {
    name: string, // null for omit
    type: TypeRef,
    optional: boolean,
    byteIndex: number,
}
interface StructBody {
    kind: 'struct',
    fields: StructField[],
    byteIndex: number,
}

interface EnumDecl {
    name: string,
    body: EnumBody,
    byteIndex: number,
}
interface StructDecl {
    name: string,
    body: StructBody,
    byteIndex: number,
}
type NamedDecl = EnumDecl | StructDecl;

interface ParserState {
    tokens: TokenPosition[],
    position: number,
    declarations: NamedDecl[],
}

function expectName(state: ParserState): string {
    const { tokens } = state;
    if (tokens[state.position].kind != 'name') {
        throw new Error(`position ${tokens[state.position].byteIndex} expect name, meet ${displayToken(tokens[state.position])}`);
    }
    const name = tokens[state.position].value as string;
    state.position += 1;
    return name;
}
function expectSeparator(state: ParserState, expect: Separator) {
    const { tokens } = state;
    if (tokens[state.position].kind != 'separator' || tokens[state.position].value != expect) {
        throw new Error(`position ${tokens[state.position].byteIndex} expect '${expect}', meet ${displayToken(tokens[state.position])}`);
    }
    state.position += 1;
}
// if meet, return true and push forward
function tryExpectSeparator(state: ParserState, expect: Separator): boolean {
    const { tokens } = state;
    if (tokens[state.position].kind == 'separator' && tokens[state.position].value == expect) {
        state.position += 1;
        return true;
    }
    return false;
}

function parse(state: ParserState) {
    while (state.position < tokens.length) {
        state.declarations.push(parseDecl(state));
    }
}
function parseDecl(state: ParserState): NamedDecl {
    // ignore leading comments
    while (state.tokens[state.position].kind == 'comment') {
        state.position += 1;
    }
    const byteIndex = state.tokens[state.position].byteIndex;
    const name = expectName(state);
    console.log(`parse decl ${name}`);
    expectSeparator(state, '=');
    const body = parseBody(state);
    return { name, body, byteIndex } as any; // ? why is this type error?
}

function parseBody(state: ParserState): StructBody | EnumBody {
    const { tokens } = state;
    if (tokens[state.position].kind == 'separator' && (tokens[state.position].value == '{' || tokens[state.position].value == '(')) {
        const byteIndex = tokens[state.position].byteIndex;
        const expectEndSeparator = tokens[state.position].value == '{' ? '}' : ')';
        state.position += 1;
        let firstFieldDef: StructField;
        let firstVariant: TaggedTypeRef;
        if (tryExpectSeparator(state, '?')) {
            // this is a field-def with name, current decl is a struct-decl
            const byteIndex = tokens[state.position].byteIndex;
            const name = expectName(state);
            console.log(`  first member is optional field ${name}`);
            expectSeparator(state, ':');
            const type = parseTypeRef(state);
            firstFieldDef = { name, type, optional: true, byteIndex };
            tryExpectSeparator(state, ','); // ignore trailing colon
        } else if (tokens[state.position].kind == 'name') {
            const byteIndex = tokens[state.position].byteIndex;
            const name = expectName(state);
            if (tryExpectSeparator(state, ':')) {
                // this is a normal non optional field def
                console.log(`  first member is nonoptional field ${name}`);
                const type = parseTypeRef(state);
                firstFieldDef = { name, type, optional: false, byteIndex };
                tryExpectSeparator(state, ','); // ignore trailing colon
            } else if (tokens[state.position].kind == 'tag') {
                // this is a variant with tag inside paren?
                console.log(`  first member is a variant with tag inside paren? ${name}`);
                firstVariant = { kind: 'name', value: name, tags: [], byteIndex };
            } else if (tokens[state.position].value == '/') {
                // this is a nameref in enum
                console.log(`  first member is a name as a enum variant ${name}`);
                firstVariant = { kind: 'name', value: name, tags: [], byteIndex };
            } else if (tryExpectSeparator(state, expectEndSeparator)) {
                // this is a { name } // why do you have this syntax?
                console.log(`  first member is the only spread field ${name}`);
                // NOTE this is the end of this invocation of parsebody
                return { kind: 'struct', fields: [{ name: null, type: { kind: 'name', value: name, byteIndex }, optional: false, byteIndex }], byteIndex };
            } else {
                // this is a spread member
                console.log(`  first member is a spread field ${name}`);
                tryExpectSeparator(state, ',');
                firstFieldDef = { name: null, type: { kind: 'name', value: name, byteIndex }, optional: false, byteIndex };
            }
        } else {
            // this is a typeref in enum
            console.log(`  first member is a enum variant`);
            firstVariant = parseTypeRef(state);
        }
        if (firstFieldDef) {
            // continue struct fields
            const fields = [firstFieldDef];
            while (true) {
                if (tryExpectSeparator(state, expectEndSeparator)) {
                    break;
                }
                const byteIndex = tokens[state.position].byteIndex;
                const optional = tryExpectSeparator(state, '?');
                const name = expectName(state);
                // console.log(`  next field name/spread name ${name}`);
                if (tryExpectSeparator(state, ':')) {
                    const type = parseTypeRef(state);
                    tryExpectSeparator(state, ',');
                    // field may end with semicolon, that is tokenized as comment
                    while (tokens[state.position].kind == 'comment') { state.position += 1; }
                    console.log(`  normal field ${name}`);
                    fields.push({ name, type, optional, byteIndex });
                } else {
                    // this is a spread member
                    tryExpectSeparator(state, ',');
                    console.log(`  spread field ${name}`);
                    fields.push({ name: null, optional, type: { kind: 'name', value: name, byteIndex }, byteIndex });
                }
            }
            return { kind: 'struct', fields, byteIndex };
        } else if (firstVariant) {
            // continue enum variable
            // the tagged type inside paren should be handled here?
            if (tokens[state.position].kind == 'tag') {
                const tagName = tokens[state.position].value as TagName;
                state.position += 1;
                let value: any;
                if (['number', 'string', 'bool'].includes(tokens[state.position].kind)) {
                    value = tokens[state.position];
                    state.position += 1;
                    console.log(`  tag ${tagName} ${value.value}`);
                } else {
                    throw new Error(`position ${byteIndex} expect literal, meet ${displayToken(tokens[state.position])}`);
                }
                firstVariant.tags.push({ tag: tagName, value, byteIndex });
            }
            const variants = [firstVariant];
            while (true) {
                if (tryExpectSeparator(state, '/')) {
                    // same as parseTypeRef, this effectively consumes all variants, need flatten them
                    const followingVariants = parseTypeRef(state);
                    if (followingVariants.kind == 'enum') {
                        variants.push(...followingVariants.variants);
                    } else {
                        variants.push(followingVariants);
                    }
                } else {
                    // in a wrapped enum, if not /, then must be ending quote
                    expectSeparator(state, expectEndSeparator);
                    break;
                }
            }
            // console.log(`  have ${variants.length} variants`);
            return { kind: 'enum', variants, byteIndex };
        } else {
            throw new Error('unreachable');
        }
    } else {
        const byteIndex = tokens[state.position].byteIndex;
        // no {} or () can only be enum
        // NOTE this invocation of parseTypeRef should already include all variants
        const variants: TaggedTypeRef[] = [];
        const firstVariant = parseTypeRef(state);
        if (firstVariant.kind == 'enum') {
            variants.push(...firstVariant.variants);
        } else {
            variants.push(firstVariant);
        }
        return { kind: 'enum', variants, byteIndex };
    }
}

function parseTypeRef(state: ParserState): TaggedTypeRef {
    const tokens = state.tokens;
    const byteIndex = tokens[state.position].byteIndex;
    // NOTE enum variants is left recursive, tag part is left recursive
    let beginTypeRef: TypeRef;
    if (tryExpectSeparator(state, '[')) {
        if (tryExpectSeparator(state, '+')) {
            const element = parseTypeRef(state);
            beginTypeRef = { kind: 'array', '>0': true, element, byteIndex };
        } else if (tryExpectSeparator(state, '*')) {
            const element = parseTypeRef(state);
            beginTypeRef = { kind: 'array', '>0': false, element, byteIndex };
        } else {
            // tuple
            const members = [parseTypeRef(state)];
            while (tryExpectSeparator(state, ',')) {
                members.push(parseTypeRef(state));
            }
            beginTypeRef = { kind: 'tuple', elements: members, byteIndex };
        }
        expectSeparator(state, ']');
    } else if (tokens[state.position].kind == 'string') {
        console.log(`  string literal '${tokens[state.position].value}'`);
        state.position += 1;
        beginTypeRef = { kind: 'string', value: tokens[state.position].value as string, byteIndex };
    } else if (tokens[state.position].kind == 'bool') {
        console.log(`  bool literal '${tokens[state.position].value}'`);
        state.position += 1;
        beginTypeRef = { kind: 'bool', value: tokens[state.position].value as boolean, byteIndex };
    } else if (tokens[state.position].kind == 'number') {
        const left = tokens[state.position].value as number;
        state.position += 1;
        expectSeparator(state, '..');
        if (tokens[state.position].kind != 'number') {
            throw new Error(`position ${byteIndex} expect number, meet ${displayToken(tokens[state.position])}`);
        }
        const right = tokens[state.position].value as number;
        state.position += 1;
        console.log(`  range ${left}..${right}`);
        beginTypeRef = { kind: 'range', left, right, byteIndex };
    } else if (tokens[state.position].value == '{' || tokens[state.position].value == '(') {
        // map is ignored for now, a {} indicates a inline struct
        beginTypeRef = parseBody(state);
    } else if (tokens[state.position].kind == 'name') {
        const name = tokens[state.position].value as string;
        state.position += 1;
        console.log(`  ref name ${name}`);
        beginTypeRef = { kind: 'name', value: name, byteIndex };
    } else {
        throw new Error(`position ${byteIndex} expect typeref, meet ${displayToken(tokens[state.position])}`);
    }

    // NOTE for now this file ends here, but there should be some other place need check eof
    if (state.position == tokens.length) {
        return { ...beginTypeRef, tags: [] };
    }

    // enum variable left recursive
    if (tokens[state.position].value == '/') {
        const variants: TaggedTypeRef[] = [{ ...beginTypeRef, tags: [] }];
        if (tryExpectSeparator(state, '/')) {
            // for first variant, this recursive call will collect all following variants, need flatten them
            const followingVariants = parseTypeRef(state);
            // but for second last recursive call, flat one layer effectively flattens complete variant array,
            // and recursive back correctly keeps the variant list always flat
            if (followingVariants.kind == 'enum') {
                variants.push(...followingVariants.variants);
            } else {
                variants.push(followingVariants);
            }
        }
        beginTypeRef = { kind: 'enum', variants, byteIndex };
    }

    // tag part is left recursive
    const tags: Tag[] = [];
    if (tokens[state.position].kind == 'tag') {
        const tagName = tokens[state.position].value as TagName;
        state.position += 1;
        let value: any;
        if (['number', 'string', 'bool'].includes(tokens[state.position].kind)) {
            value = tokens[state.position];
            state.position += 1;
            console.log(`  tag ${tagName} ${value.value}`);
        } else {
            throw new Error(`position ${byteIndex} expect literal, meet ${displayToken(tokens[state.position])}`);
        }
        tags.push({ tag: tagName, value, byteIndex });
    }
    return { ...beginTypeRef, tags };
}

const tokens = tokenize(cddlContent);
console.log(tokens.slice(20, 80).map(t => displayToken(t)).join('\n'));
const parserState: ParserState = { tokens, position: 0, declarations: [] };
parse(parserState);
await fs.writeFile('codegen/ast.json', JSON.stringify(parserState.declarations, undefined, 2));
