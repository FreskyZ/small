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

// NOTE HARDCODE
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
    'script.SerializationOptions = { ?maxDomDepth: js-uint, ?maxObjectDepth: js-uint, ?includeShadowTree: "none" / "open" / "all" }' +
    cddlContent.substring(wtftype2EndIndex + 1);

// await fs.writeFile('codegen/spec.cddl', cddlContent);

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
    type: TaggedTypeRef,
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
    logs: string[],
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

function parseSpec(state: ParserState) {
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
    state.logs.push(`parse decl ${name}`);
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
            state.logs.push(`  first member is optional field ${name}`);
            expectSeparator(state, ':');
            const type = parseTypeRef(state);
            firstFieldDef = { name, type, optional: true, byteIndex };
            tryExpectSeparator(state, ','); // ignore trailing colon
        } else if (tokens[state.position].kind == 'name') {
            const byteIndex = tokens[state.position].byteIndex;
            const name = expectName(state);
            if (tryExpectSeparator(state, ':')) {
                // this is a normal non optional field def
                state.logs.push(`  first member is nonoptional field ${name}`);
                const type = parseTypeRef(state);
                firstFieldDef = { name, type, optional: false, byteIndex };
                tryExpectSeparator(state, ','); // ignore trailing colon
            } else if (tokens[state.position].kind == 'tag') {
                // this is a variant with tag inside paren?
                state.logs.push(`  first member is a variant with tag inside paren? ${name}`);
                firstVariant = { kind: 'name', value: name, tags: [], byteIndex };
            } else if (tokens[state.position].value == '/') {
                // this is a nameref in enum
                state.logs.push(`  first member is a name as a enum variant ${name}`);
                firstVariant = { kind: 'name', value: name, tags: [], byteIndex };
            } else if (tryExpectSeparator(state, expectEndSeparator)) {
                // this is a { name } // why do you have this syntax?
                state.logs.push(`  first member is the only spread field ${name}`);
                // NOTE this is the end of this invocation of parsebody
                return { kind: 'struct', fields: [{ name: null, type: { kind: 'name', value: name, tags: [], byteIndex }, optional: false, byteIndex }], byteIndex };
            } else {
                // this is a spread member
                state.logs.push(`  first member is a spread field ${name}`);
                tryExpectSeparator(state, ',');
                firstFieldDef = { name: null, type: { kind: 'name', value: name, tags: [], byteIndex }, optional: false, byteIndex };
            }
        } else {
            // this is a typeref in enum
            state.logs.push(`  first member is a enum variant`);
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
                if (tryExpectSeparator(state, ':')) {
                    const type = parseTypeRef(state);
                    tryExpectSeparator(state, ',');
                    // field may end with semicolon, that is tokenized as comment
                    while (tokens[state.position].kind == 'comment') { state.position += 1; }
                    state.logs.push(`  normal field ${name}`);
                    fields.push({ name, type, optional, byteIndex });
                } else {
                    // this is a spread member
                    tryExpectSeparator(state, ',');
                    state.logs.push(`  spread field ${name}`);
                    fields.push({ name: null, optional, type: { kind: 'name', value: name, tags: [], byteIndex }, byteIndex });
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
                    state.logs.push(`  tag ${tagName} ${value.value}`);
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
        state.logs.push(`  string literal '${tokens[state.position].value}'`);
        const value = tokens[state.position].value as string;
        state.position += 1;
        beginTypeRef = { kind: 'string', value, byteIndex };
    } else if (tokens[state.position].kind == 'bool') {
        state.logs.push(`  bool literal '${tokens[state.position].value}'`);
        const value = tokens[state.position].value as boolean;
        state.position += 1;
        beginTypeRef = { kind: 'bool', value, byteIndex };
    } else if (tokens[state.position].kind == 'number') {
        const left = tokens[state.position].value as number;
        state.position += 1;
        expectSeparator(state, '..');
        if (tokens[state.position].kind != 'number') {
            throw new Error(`position ${byteIndex} expect number, meet ${displayToken(tokens[state.position])}`);
        }
        const right = tokens[state.position].value as number;
        state.position += 1;
        state.logs.push(`  range ${left}..${right}`);
        beginTypeRef = { kind: 'range', left, right, byteIndex };
    } else if (tokens[state.position].value == '{' || tokens[state.position].value == '(') {
        // map is ignored for now, a {} indicates a inline struct
        beginTypeRef = parseBody(state);
    } else if (tokens[state.position].kind == 'name') {
        const name = tokens[state.position].value as string;
        state.position += 1;
        state.logs.push(`  ref name ${name}`);
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
            state.logs.push(`  tag ${tagName} ${value.value}`);
        } else {
            throw new Error(`position ${byteIndex} expect literal, meet ${displayToken(tokens[state.position])}`);
        }
        tags.push({ tag: tagName, value, byteIndex });
    }
    return { ...beginTypeRef, tags };
}

const tokens = tokenize(cddlContent);
// console.log(tokens.slice(20, 80).map(t => displayToken(t)).join('\n'));
const parserState: ParserState = { tokens, position: 0, declarations: [], logs: [] };
parseSpec(parserState);
const declarations = parserState.declarations;
// await fs.writeFile('codegen/ast.json', JSON.stringify(declarations, undefined, 2));

// validate reference
const declaredNames = declarations.map(d => d.name);
const builtinNames = ['text', 'bool', 'any', 'float', 'null', 'number'];

function validateTypeRef(node: TypeRef) {
    if (node.kind == 'name') {
        if (!builtinNames.includes(node.value) && !declaredNames.includes(node.value)) {
            console.log(`span ${node.byteIndex} referenced name ${node.value} not found`);
        }
    } else if (node.kind == 'array') {
        validateTypeRef(node.element);
    } else if (node.kind == 'tuple') {
        for (const element of node.elements) {
            validateTypeRef(element);
        }
    } else if (node.kind == 'struct') {
        validateStructBody(node);
    } else if (node.kind == 'enum') {
        validateEnumBody(node);
    }
}
function validateStructBody(node: StructBody) {
    for (const field of node.fields) {
        validateTypeRef(field.type);
    }
}
function validateEnumBody(node: EnumBody) {
    for (const variant of node.variants) {
        validateTypeRef(variant);
    }
}
function validateDeclarations(declarations: NamedDecl[]) {
    for (const declaration of declarations) {
        if (declaration.body.kind == 'struct') {
            validateStructBody(declaration.body);
        } else {
            validateEnumBody(declaration.body);
        }
    }
}
validateDeclarations(declarations);

interface CommandModule {
    name: string, // this is the camelCase name, e.g. browsingContext
    methods: string[], // this is the camelCase name, e.g. locateNode
    events: string[], // this is the camelCase name, e.g. contextCreated
}
function validateCommands(declarations: NamedDecl[], info: boolean): CommandModule[] {
    // event data comes from global type EventData variants
    // event name comes from EventData variants variants method property
    // event data should have consistent name with method
    const moduleNames = declarations
        .map(d => d.name.split('.')).filter(n => n.length == 2).map(n => n[0])
        .filter((n, i, a) => a.indexOf(n) == i);
    const moduleNameUppers = moduleNames.map(m => m.at(0).toUpperCase() + m.substring(1));
    const modules = moduleNames.map<CommandModule>(m => ({ name: m, methods: [], events: [] }));
    if (info) { console.log(`${modules.length} modules`); }

    const summaryCommandTypeNames = (declarations.find(d =>
        d.name  == 'CommandData').body as EnumBody).variants.map(v => (v as NameRef).value);
    if (info) { console.log(`${summaryCommandTypeNames.length} summary command types`); }
    // they are in format ${module}Command
    const invalidSummaryCommandTypeNames = summaryCommandTypeNames
        .filter(n => !moduleNameUppers.some(m => n == `${m}Command`));
    if (invalidSummaryCommandTypeNames.length) {
        console.log(`CommandData variant invalid format: ${invalidSummaryCommandTypeNames.join(', ')}`);
    }
    // check all ends with Command type name is CommandData variant
    const notIncludedEndWithCommandTypeNames = declarations.map(d => d.name)
        .filter(n => n.endsWith('Command') && n != 'Command' && !summaryCommandTypeNames.includes(n));
    if (notIncludedEndWithCommandTypeNames.length) {
        console.log(`end with Command but not included in CommandData: ${notIncludedEndWithCommandTypeNames.join(', ')}`);
    }
    // NOTE no check all modules have Command type, because some modules may not have command/event

    const summaryResultTypeNames = (declarations.find(d =>
        d.name  == 'ResultData').body as EnumBody).variants.map(v => (v as NameRef).value);
    if (info) { console.log(`${summaryResultTypeNames.length} summary result types`); }
    // they are in format ${module}Result
    const invalidSummaryResultTypeNames = summaryResultTypeNames
        .filter(n => !moduleNameUppers.some(m => n == `${m}Result`));
    if (invalidSummaryResultTypeNames.length) {
        console.log(`ResultData variant invalid format: ${invalidSummaryResultTypeNames.join(', ')}`);
    }
    // not same with Command, concrete command type does not have postfix, while concrete result types have Result postfix
    const concreteResultTypeNames = summaryResultTypeNames.map(n => declarations
        .find(d => d.name == n)).flatMap(t => (t.body as EnumBody).variants.map(v => (v as NameRef).value));
    // NOTE HARDCODE found 2 their errors, ignore for now
    concreteResultTypeNames.push('emulation.SetNetworkConditionsResult', 'emulation.SetScreenSettingsOverrideResult');
    if (info) { console.log(`${concreteResultTypeNames.length} concrete result types`); }
    // check all ends with Result type name is variants or variants variants
    const notIncludedEndWithResultTypeNames = declarations.map(d => d.name)
        .filter(n => n.endsWith('Result') && n != 'Result' && n != 'EmptyResult'
            && !summaryResultTypeNames.includes(n) && !concreteResultTypeNames.includes(n));
    if (notIncludedEndWithResultTypeNames.length) {
        console.log(`end with Result but not included in CommandData: ${notIncludedEndWithResultTypeNames.join(', ')}`);
    }

    const concreteCommandTypeNames = summaryCommandTypeNames
        .map(n => declarations.find(d => d.name == n))
        .flatMap(t => (t.body as EnumBody).variants.map(v => (v as NameRef).value));
    for (const typename of concreteCommandTypeNames) {
        const [moduleName, methodName] = typename.split('.');
        const methodNameLower = methodName.at(0).toLowerCase() + methodName.substring(1);
        const methodPropertyType = ((declarations.find(d => d.name == typename)
            .body as StructBody).fields.find(f => f.name == 'method').type as StringLitRef).value;
        if (`${moduleName}.${methodNameLower}` != methodPropertyType) {
            console.log(`command type ${typename} name inconsistent with method type ${methodPropertyType}`);
        }
        modules.find(m => m.name == moduleName).methods.push(methodNameLower);
        // have corresponding result type
        const expectResultTypeName = `${typename}Result`;
        if (!concreteResultTypeNames.includes(expectResultTypeName)) {
            console.log(`expected result type ${expectResultTypeName} not found`);
        }
    }
    // method list from concrete result types should be same as method list from concrete command types
    for (const typename of concreteResultTypeNames) {
        if (!typename.endsWith('Result')) {
            console.log(`result type ${typename} invalid format`);
        }
        const [moduleName, methodName] = typename.substring(0, typename.length - 6).split('.');
        const methodNameLower = methodName.at(0).toLowerCase() + methodName.substring(1);
        if (!modules.some(m => m.name == moduleName && m.methods.some(m => m == methodNameLower))) {
            console.log(`result type ${typename} cannot find corresponding method`);
        }
    }
    if (info) { console.log(`${modules.flatMap(m => m.methods).length} methods`); }

    const summaryEventTypeNames = (declarations.find(d =>
        d.name  == 'EventData').body as EnumBody).variants.map(v => (v as NameRef).value);
    if (info) { console.log(`${summaryEventTypeNames.length} summary event types`); }
    // they are in format ${module}Event
    const invalidSummaryEventTypeNames = summaryEventTypeNames
        .filter(n => !moduleNameUppers.some(m => n == `${m}Event`));
    if (invalidSummaryEventTypeNames.length) {
        console.log(`EventData variant invalid format: ${invalidSummaryEventTypeNames.join(', ')}`);
    }
    // check all ends with Command type name is EventData variant
    const notIncludedEndWithEventTypeNames = declarations.map(d => d.name)
        .filter(n => n.endsWith('Event') && n != 'Event' && !summaryEventTypeNames.includes(n));
    if (notIncludedEndWithEventTypeNames.length) {
        console.log(`end with Event but not included in EventData: ${notIncludedEndWithEventTypeNames.join(', ')}`);
    }

    // NOTE HARDCODE fix for LogEvent = (log.EntryAdded), also InputEvent = (input.FileDialogOpened)
    // no way to determine this is a variant type but not a struct type with single spread member according to their syntax
    const logevent = declarations.find(d => d.name == 'LogEvent');
    logevent.body.kind = 'enum';
    (logevent.body as EnumBody).variants = [(logevent.body as StructBody).fields[0].type];
    const inputevent = declarations.find(d => d.name == 'InputEvent');
    inputevent.body.kind = 'enum';
    (inputevent.body as EnumBody).variants = [(inputevent.body as StructBody).fields[0].type];

    const concreteEventTypeNames = summaryEventTypeNames.map(n => declarations
        .find(d => d.name == n)).flatMap(t => (t.body as EnumBody).variants.map(v => (v as NameRef).value));
    for (const typename of concreteEventTypeNames) {
        const [moduleName, eventName] = typename.split('.');
        const eventNameLower = eventName.at(0).toLowerCase() + eventName.substring(1);
        const methodPropertyType = ((declarations.find(d => d.name == typename)
            .body as StructBody).fields.find(f => f.name == 'method').type as StringLitRef).value;
        if (`${moduleName}.${eventNameLower}` != methodPropertyType) {
            console.log(`event type ${typename} name inconsistent with method type ${methodPropertyType}`);
        }
        modules.find(m => m.name == moduleName).events.push(eventNameLower);
    }
    if (info) { console.log(`${modules.flatMap(m => m.events).length} events`); }
    return modules;
}
const modules = validateCommands(declarations, false);

// stage 3. generate
const indents = new Array(10).fill(0).map((_, i) => new Array(i * 4).fill(' ').join(''));

// why does typescript api call everything a host?
interface EmitHost {
    b: string,
    level: number,
}
function generateTypeRef(s: EmitHost, node: TypeRef) {

    const taggedNode = node as TaggedTypeRef;
    if (taggedNode.tags && taggedNode.tags.length) {
        s.b += '/** ';
        for (const tag of taggedNode.tags) {
            if (tag.tag == '.default') {
                const quote = tag.value.kind == 'string' ? "'" : '';
                s.b += `@default ${quote}${tag.value.value}${quote}`;
            } else if (['.gt', '.ge', '.lt', '.le'].includes(tag.tag)) {
                const separators = { '.gt': '>', '.ge': '>=', '.lt': '<', '.le': '<=' };
                s.b += `${separators[tag.tag]} ${tag.value.value}`;
            }
        }
        s.b += ' */ ';
    }

    if (node.kind == 'name') {
        if (node.value == 'js-int') {
            s.b += `int`;
        } else if (node.value == 'js-uint') {
            s.b += `uint`;
        } else if (node.value == 'bool') {
            s.b += `boolean`;
        } else {
            s.b += `${node.value}`;
        }
    } else if (node.kind == 'array') {
        if (node['>0']) { s.b += '/** >0 */ '; }
        if (node.element.kind == 'enum') {
            s.b += '(';
        }
        generateTypeRef(s, node.element);
        if (node.element.kind == 'enum') {
            s.b += ')';
        }
        s.b += '[]';
    } else if (node.kind == 'tuple') {
        s.b += `[`;
        for (const element of node.elements) {
            generateTypeRef(s, element);
            s.b += ', ';
        }
        s.b = s.b.substring(0, s.b.length - 2);
        s.b += `]`;
    } else if (node.kind == 'range') {
        s.b += `/* ${node.left}..${node.right} */ number`;
    } else if (node.kind == 'string') {
        s.b += `'${node.value}'`;
    } else if (node.kind == 'bool') {
        s.b += `${node.value ? 'true' : 'false'}`;
    } else if (node.kind == 'struct') {
        s.level += 1;
        generateStructBody(s, node, true);
        s.level -= 1;
    } else if (node.kind == 'enum') {
        generateEnumBody(s, node);
    }
}
function generateStructBody(s: EmitHost, node: StructBody, inline: boolean) {
    // handle single spread member situation
    if (inline && node.fields.filter(f => !f.name).length == node.fields.length) {
        if (node.fields.length == 1) {
            generateTypeRef(s, node.fields[0].type);
        } else {
            console.log(`what is this multipple member but all member is spread inline struct?`);
        }
        return;
    }
    s.b += '{\n';
    for (const field of node.fields) {
        if (field.name) {
            s.b += `${indents[s.level]}${field.name}${field.optional ? '?' : ''}: `;
            generateTypeRef(s, field.type);
            s.b += ',\n';
        }
    }
    s.b += `${indents[s.level - 1]}}`;
}
function generateEnumBody(s: EmitHost, node: EnumBody) {
    // try simply choose multiple by variant count >3
    if (node.variants.length <= 3) {
        for (const variant of node.variants) {
            generateTypeRef(s, variant);
            s.b += ' | ';
        }
        s.b = s.b.substring(0, s.b.length - 3);
    } else {
        s.b += '\n';
        s.level += 1;
        for (const variant of node.variants) {
            s.b += `${indents[s.level]}| `;
            generateTypeRef(s, variant);
            s.b += '\n';
        }
        s.b = s.b.substring(0, s.b.length - 1);
        s.level -= 1;
    }
}
function generateDecl(s: EmitHost, node: NamedDecl) {
    s.b += '\n';
    if (node.body.kind == 'struct') {
        const basetypes: string[] = [];
        for (const field of node.body.fields) {
            if (!field.name) {
                if (field.type.kind != 'name') {
                    throw new Error('unreachable');
                }
                if (field.type.value == 'Extensible') {
                    s.b += `${indents[s.level]}// implementation defined non exhausitive\n`;
                } else {
                    basetypes.push(field.type.value);
                }
            }
        }

        const hasVariant = basetypes.some(n => declarations.find(d => d.name == n).body.kind == 'enum');
        if (hasVariant || basetypes.length > 1) {
            if (basetypes.length == 1) {
                s.b += `${indents[s.level]}export type ${node.name.split('.').at(-1)} = ${basetypes[0]} & `;
            } else {
                s.b += `${indents[s.level]}export type ${node.name.split('.').at(-1)} =\n`;
                for (const typename of basetypes) {
                    s.b += `${indents[s.level + 1]}& ${typename}\n`;
                }
                s.b += `${indents[s.level + 1]}& `;
            }
        } else {
            s.b += `${indents[s.level]}export interface ${node.name.split('.').at(-1)} `;
            if (basetypes.length) {
                // multiple basetype is in previous branch
                s.b += `extends ${basetypes[0]} `;
            }
        }
        s.level += 1;
        generateStructBody(s, node.body, false);
        s.level -= 1;
        s.b += '\n';
    } else {
        s.b += `${indents[s.level]}export type ${node.name.split('.').at(-1)} = `;
        generateEnumBody(s, node.body);
        s.b += ';\n';
    }
}

function generate(s: EmitHost, declarations: NamedDecl[]) {

    s.b += '\n';
    s.b += `type int = number; // abs <= max safe int\n`;
    s.b += `type uint = number; // <= max safe int\n`;
    s.b += `type float = number;\n`;
    s.b += `type text = string;\n`;
    
    const moduleNameUppers = modules.map(m => m.name.at(0).toUpperCase() + m.name.substring(1));
    for (const decl of declarations.filter(d => d.name.split('.').length == 1)) {
        // ignore very special types
        if (['Extensible', 'js-int', 'js-uint'].includes(decl.name)) {
            continue;
        }
        // skip summary types, they are changed to inside namespace
        if (moduleNameUppers.some(m => ['Command', 'Result', 'Event'].some(p => `${m}${p}` == decl.name))) {
            continue;
        }
        // change overall summary types variants to inside namespace version
        if (decl.name == 'CommandData') {
            for (const variant of (decl.body as EnumBody).variants) {
                const originalValue = (variant as NameRef).value;
                (variant as NameRef).value = originalValue.at(0).toLowerCase() +
                    originalValue.substring(1, originalValue.length - 7) + '.Command';
            }
        } else if (decl.name == 'ResultData') {
            for (const variant of (decl.body as EnumBody).variants) {
                const originalValue = (variant as NameRef).value;
                (variant as NameRef).value = originalValue.at(0).toLowerCase() +
                    originalValue.substring(1, originalValue.length - 6) + '.Result';
            }
        } else if (decl.name == 'EventData') {
            for (const variant of (decl.body as EnumBody).variants) {
                const originalValue = (variant as NameRef).value;
                (variant as NameRef).value = originalValue.at(0).toLowerCase() +
                    originalValue.substring(1, originalValue.length - 5) + '.Event';
            }
        }
        generateDecl(s, decl);
    }

    s.b += '\n';
    s.b += `export type Method = Command['method'];\n`;
    s.b += `export type MethodMap<M extends Method> = Extract<Command, { method: M }>['params'];\n`;
    // make a result map type
    s.b += `export type MethodResultMap = {\n`;
    for (const module of modules) {
        for (const method of module.methods) {
            s.b += `    '${module.name}.${method}': ${module.name}.${method.at(0).toUpperCase()}${method.substring(1)}Result,\n`;
        }
    }
    s.b += '}\n';
    s.b += `export type EventName = Event['method'];\n`;

    s.level = 1;
    for (const module of modules) {
        s.b += `\nexport namespace ${module.name} {\n`;
        // first non command/result/event types, then summary types, then commnd+result for each method, then event
        
        const moduleNameUpper = module.name.at(0).toUpperCase() + module.name.substring(1);
    
        const commandAndResultTypes = module.methods.map(m => m.at(0).toUpperCase() + m.substring(1)).flatMap(m => [
            declarations.find(d => d.name == `${module.name}.${m}`),
            declarations.find(d => d.name == `${module.name}.${m}Result`),
        ]);
        const eventTypes = module.events
            .map(e => e.at(0).toUpperCase() + e.substring(1))
            .map(e => declarations.find(d => d.name == `${module.name}.${e}`));
        const otherTypes = declarations
            .filter(d => d.name.startsWith(`${module.name}.`))
            .filter(d => !commandAndResultTypes.some(c => c.name == d.name) && !eventTypes.some(e => e.name == d.name));
    
        const summaryTypes = ['Command', 'Result', 'Event'].map(postfix => {
            const decl = declarations.find(d => d.name == `${moduleNameUpper}${postfix}`);
            if (decl) {
                // change it to inside namespace
                decl.name = `${module.name}.${postfix}`;
                return decl;
            }
        }).filter(x => x);

        for (const decl of [otherTypes, summaryTypes, commandAndResultTypes, eventTypes].flat()) {
            generateDecl(s, decl);
        }
        s.b += `}\n`; // end namespace
    }
}

const emitHost: EmitHost = {
    b: '// auto generated\n',
    level: 0,
};
generate(emitHost, declarations);
await fs.writeFile('src/spec.ts', emitHost.b);
