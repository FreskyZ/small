# Whitespace Issue

whitespace issue becomes an issue when it becomes an issue, I mean for most of the time it is not an issue, so that
most places don't display all whitespace characters and often automatically handles whitespace characters, making it
hard when whitespace characters really matters, a common example is that git should respect trailing whitespaces in
tracked files or else it will not work well, and now llm message history should respect trailing whitespaces or else
you pay for 10x or 100x cache miss price and it becomes an issue related with money

by the way, generated assistant message will have trailing whitespace because models are trained with materials with
trailing whitespace, these materials is written by human and human constantly write trailing whitespace without help
of tools, on the other side, it is not ok for llm api providers to remove all trailing whitespaces, some of them may
have real meaning e.g. as markdown syntax

this is discovered by an issue that the yaml library cannot render multiple line string content literally but only
in single line escaped format, or according to terms in spec, expect literal block scalar style, meet double quoted
flow scalar style, this is a minified reproduction, note that it's trailing whitespace inside content, not after the
main content

```rust
assert_eq!(serde_yaml_ng::to_string(&serde_yaml_ng::Value::Mapping({
    let mut map = serde_yaml_ng::Mapping::new();
    map.insert(serde_yaml_ng::Value::String("key".to_string()), serde_yaml_ng::Value::String("line1\nline2".to_string()));
    map
})).expect("failed to serialize"), "key: |-\n  line1\n  line2\n");
assert_eq!(serde_yaml_ng::to_string(&serde_yaml_ng::Value::Mapping({
    let mut map = serde_yaml_ng::Mapping::new();
    map.insert(serde_yaml_ng::Value::String("key".to_string()), serde_yaml_ng::Value::String("line1 \nline2".to_string()));
    map
})).expect("failed to serialize"), "key: \"line1 \\nline2\"\n");
```

additionally, it's reproduced in python pyyaml library https://pypi.org/project/pyyaml

```py
# what's this?
assert yaml.dump({ "key": "line1\nline2" }) == "key: 'line1\n\n  line2'\n"
assert yaml.dump({ "key": "line1 \nline2" }) == 'key: "line1 \\nline2"\n'
# you need this for explicit block style https://stackoverflow.com/a/7445560
class literal_helper(str): pass
def literal_representer(dumper, data):
    return dumper.represent_scalar(u'tag:yaml.org,2002:str', data, style='|')
yaml.add_representer(literal_helper, literal_representer)
print(yaml.dump({ "key": literal_helper("line1\nline2") })) # 'key: |-\n  line1\n  line2\n'
print(yaml.dump({ "key": literal_helper("line1 \nline2") })) # 'key: "line1 \\nline2"\n'
```

it is not reproduced in nodejs yaml library https://npmjs.com/package/yaml

```js
assert.strictEqual(yaml.stringify({ key: 'line1\nline2' }), 'key: |-\n  line1\n  line2\n');
assert.strictEqual(yaml.stringify({ key: 'line1 \nline2' }), 'key: |-\n  line1 \n  line2\n');
```

serde_yaml_ng and pyyaml have same results because they have same underlying implementation,

- serde_yaml_ng depends on rust library unsafe-libyaml https://crates.io/crates/unsafe-libyaml, it is automatically
  converted from libyaml C source code, without any rewrite or restructure to remove redundent unsafe blocks in the
  conversion result, as indicated by its crate name, so its implementation detail is the same as libyaml
- pyyaml https://github.com/yaml/pyyaml document https://pyyaml.org/wiki/PyYAMLDocumentation shows it won't install
  libyaml bindings by default, so you will be running pure python version without additional setup, but that's also
  the same implementation detail as libyaml

the related code is at

- serde_yaml_ng always specify literal style for any multiple line content
  https://github.com/acatton/serde-yaml-ng/blob/3628102977f3ec9e02b95ef32fcec30b3df91390/src/ser.rs#L355
- but libyaml emitter https://github.com/yaml/libyaml/blob/master/src/emitter.c#L1663
  and pyyaml emitter https://github.com/yaml/pyyaml/blob/main/lib/yaml/emitter.py#L751
  and unsafe-libyaml emitter https://github.com/dtolnay/unsafe-libyaml/blob/master/src/emitter.rs#L1561
  is rejecting block style according to trailing space flag with exactly same logic, resulting in a quoted style

by the way, as previous section is comparing 2 alternative implementations to libyaml, and libyaml is hosted in the
same github orgnization as yaml spec, you may think libyaml is the official reference implementation and pyyaml and
the serde_yaml_* rewrite the same logic in other language, but that's not true, according to the history section in
yaml spec and additional stories by ai, pyyaml is first created by the community and later libyaml is separated and
rewritten into C language for performance improvements while keeping all implementation detail the same, they later
became the defacto reference implementation because of their completeness and quality, and the collecting of pyyaml,
libyaml and the spec into the same github orgnization is a later event, at around 2009, or yaml 1.2.0 era, this is
also indicated by their document site https://pyyaml.org/wiki/PyYAMLDocumentation and https://pyyaml.org/wiki/LibYAML
is under same domain but not https://yaml.org

by the way, unsafe-libyaml is deprecated and repository is archived, this is a major supply chain security issue,
but not very related to this document, yet. also libyaml is not in active development in recent years, resulting in
another supply chain security risk, I assume they don't receive much human attention because yaml format is not that
popular in rust and python ecosystem, "even python standard library don't include yaml", and users with knowledge
that a json parser and serializer is very easy to implement will assume yaml parser and serializers, although more
complex than json, will be implemented in common libraries' own language, not considering actually it's implemented
in a memory unsafe native language

you think libyaml is the reference implementation (or you know this part of history and still regard libyaml as the
reference implementation), so it should be correct and specification specified operation, and ask ai and ai say yes,
and that's not true, libyaml is not following spec and adding redundent logic to reject correct rendering options

see spec

- 8.1.2 literal block style https://yaml.org/spec/1.2.2/#812-literal-style
  `Inside literal scalars, all (indented) characters are considered to be content, including white space characters.`
  trailing whitespace characters are included in indented blocks,
- related syntax definition
  - `[170] c-l+literal(n) ::= c-literal c-b-block-header(t) l-literal-content(n+m,t)`,
    c-literal is the | character, or \x7c
  - `[162] c-b-block-header(t) ::= ((c-indentation-indicator c-chomping-indicator(t)) | (c-chomping-indicator(t) c-indentation-indicator)) s-b-comment`
    c-indentation-indicator is ascii numbers 1-9, used when multiple line content has leading whitespace before main content,
    c-chomping-indicator is chomping trailing whitespace and trailing empty lines after main content, not related to internal trailing whitespaces,
    s-b-comment is optional trailing inline comment
  - `[173] l-literal-content(n,t) ::= (l-nb-literal-text(n) b-nb-literal-next(n)* b-chomped-last(t))? l-chomped-empty(n,t)`
    b-comped-last is chomping trailing whitespace after main content, l-chomped-empty is chomping trailing empty lines after main content
  - `[172] b-nb-literal-next(n) ::= b-as-line-feed l-nb-literal-text(n)`
    b-as-line-feed is cr, lf or crlf
  - `[171] l-nb-literal-text(n) ::= l-empty(n,BLOCK-IN)* s-indent(n) nb-char+`
    l-empty and s-indent is all about leading indentions and leading whitespace characters,
    if you are interested, this specification is defining complex indention aware syntax using these complex rules
  - `[27] nb-char ::= c-printable - b-char - c-byte-order-mark`,
    c-printable is ascii printable include \x20 and nearly all bmp code points and literally all non bmp code points,
    (by the way there is a lot of control characters or look like control characters in non ascii characters, I think
    this similar punctuation issue will become a security issue in future), b-char is cr and lf, c-byte-order-mark is bom,
    so \x20 is not subtracted from the c-printable collection

by the way, it is even accepted by deserialization part of the library

```rust
assert_eq!(serde_yaml_ng::from_str::<serde_yaml_ng::Value>("key: |-\n  line1 \n  line2\n")
  .unwrap().as_mapping().unwrap().get("key").unwrap().as_str().unwrap(), "line1 \nline2");
```

so the conclusion is trailing whitespace inside content is valid input in literal block scalar style, pyyaml and
its descendent libraries are incorrect, nodejs yaml is correct as an independent implementation

but on the other side, I'd like to defensively avoid any trailing whitespaces appear in the text file, by the most
strange trailing whitespace handling approach I've error seen, by removing and record trailing whitespace locations
at the same time, and store them elsewhere without using trailing whitespaces, and later reconstruct exact original
content to use in llm message history, also check for accidental trailing whitespaces in system and user message by
the way, this avoids cache miss accident in both kinds of messages
