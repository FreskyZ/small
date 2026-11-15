use anyhow::Result;
use bytes::{BufMut as _, Bytes, BytesMut};

// parse server sent events
// - html spec (why is this not rfc) https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
// - mdn https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format
// - by the way, microsoft branded not active developing but active downloaded package https://www.npmjs.com/package/@microsoft/fetch-event-source

// according to spec
// - stream = event*
// - event = (comment | field)* EOL
// - comment = COLON ANY* EOL
// - field = field-name (COLON SPACE ANY*)? EOL   # this space don't have star
// - field-name = ANYEXCEPT*                      # any char except colon, cr and lf
// - EOL = CR | LF | CR LF
// - ANY is any utf8 char, ANY* is any utf8 sequence

// - the common practice is split whole response by \n\n, and then split message (event) by \n into fields, but actually
//   the \n\n comes from field's eol + message's eol, if the final message miss the eol, it is not complete and is not dispatched
// - a field can have extra space after the colon, but not before, before the colon is always field name
//   field without colon is regarded all as field name and no field value, what's the usage? emptify last event id and event type?
// - for web EventSource api, field names allow id, event, data, retry, others are ignored
//   - id does not allow \0?, or else it is ignored, why specifically apply to id?
//     use in last-event-id, while I don't see any discussion about this in llm apis?
//   - event is event name use in .addEventListener, which default to message
//   - data is data, can have multiple data in one message, they are concat with .join(\n)
//   - retry is retry time, why do server send this?
//   - if you have control of server and client side you can have custom field names? not for this scenario
// - a message with empty data is not dispatched
// - there is NO guarantee over a message will not be cut in the middle in 2 transmits,
//   there is NO guarantee over a utf8 multi byte character will not be cut in the middle in 2 transmits,
//   so you need a byte level parser to parse messages

// id is not used in llm apis
#[derive(Debug)]
pub struct ServerSentEvent {
    pub name: Option<String>,
    pub data: String,
}

pub struct EventStreamParser {
    buffer: BytesMut,
    position: usize,
    current_event: Option<Vec<u8>>,
    current_data: BytesMut,
}
impl EventStreamParser {
    pub fn new() -> Self {
        Self {
            buffer: BytesMut::with_capacity(1024),
            position: 0,
            current_event: None,
            current_data: BytesMut::with_capacity(1024),
        }
    }

    pub fn push(&mut self, bytes: Bytes) {
        self.buffer.extend_from_slice(&bytes);
    }
    // only return event.data as llm apis do not use id and type properties
    // no expected error yet, still return Result in case needed in future
    pub fn pull(&mut self) -> Result<Option<ServerSentEvent>> {
        loop {
            // eol begin index and eol end index, same for bare cr and normal lf, +1 for crlf
            let eol_index = match (
                self.buffer.iter().skip(self.position).position(|b| *b == b'\r'),
                self.buffer.iter().skip(self.position).position(|b| *b == b'\n'),
            ) {
                // line not completed, wait for more
                (None, None) => return Ok(None),
                // cannot decide bare cr if it is exactly end of current buffer, wait for more
                (Some(cr_index), None) if cr_index == self.buffer.len() - 1 => return Ok(None),
                // bare cr
                (Some(cr_index), None) => (cr_index, cr_index),
                (Some(cr_index), Some(lf_index)) if cr_index + 1 < lf_index => (cr_index, cr_index),
                // normal lf
                (None, Some(lf_index)) => (lf_index, lf_index),
                (Some(cr_index), Some(lf_index)) if cr_index > lf_index => (lf_index, lf_index),
                // crlf
                (Some(cr_index), Some(lf_index)) if cr_index + 1 == lf_index => (cr_index, lf_index),
                // previous conditions have fully covered cr_index and lf_index relationships, but compiler don't know that
                _ => unreachable!("unexpected cr_index and lf_index relationship"),
            };
            // note the previous eol index is relative to self.position
            let eol_index = (eol_index.0 + self.position, eol_index.1 + self.position);

            if eol_index.0 == self.position { // empty line, end of message
                if let Some(c) = self.current_data.last() && c == &b'\n' {
                    // according to spec, trim one ending lf, making data concat effectively join(\n)
                    self.current_data.truncate(self.current_data.len() - 1);
                }
                // discard used buffer
                self.buffer = self.buffer.split_off(eol_index.1 + 1);
                self.position = 0;
                // // from_utf8_lossy_owned is super new rust 1.99 function
                let result_event = self.current_event.take().map(|v| String::from_utf8_lossy_owned(v));
                let result_data = String::from_utf8_lossy_owned(self.current_data.split_off(0).to_vec());
                // according to spec, do not dispatch no data event
                return if result_data.is_empty() { Ok(None) } else { Ok(Some(ServerSentEvent{ name: result_event, data: result_data })) };
            } else {
                // field without eol
                let field = &self.buffer[self.position..eol_index.0];
                self.position = eol_index.1 + 1;
                let (name, value) = if let Some(colon_index) = field.iter().position(|b| *b == b':') {
                    // note the result value may be empty
                    (&field[..colon_index], &field[colon_index + 1..])
                } else {
                    // println!("you really have field without value? {:?}", field);
                    (field, &[] as &[u8]) // you need this as to convert from &[{unknown};0] to &[u8]?
                };
                if name.is_empty() {
                    // println!("you really have comment? {:?}: {:?}", name, value);
                } else if name == b"data" {
                    // according to spec, remove one ascii whitespace from beginning of value
                    let value = if !value.is_empty() && value[0] == b' ' { &value[1..] } else { value };
                    self.current_data.extend_from_slice(value);
                    // according to spec, join data lines by single lf regardless of actual eol
                    self.current_data.put_u8(b'\n');
                } else if name == b"event" {
                    // according to spec, remove one ascii whitespace from beginning of value
                    let value = if !value.is_empty() && value[0] == b' ' { &value[1..] } else { value };
                    // overwrite if duplicate field name
                    self.current_event = Some(value.to_vec());
                } else {
                    // println!("you really have field other than event and data? {:?}: {:?}", name, value);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

#[test]
fn test_event_stream() {
    use std::assert_matches;
    // chrome's test case is at
    // https://github.com/chromium/chromium/blob/5774ba7f90c367cf32a17dc65f530d63cd09d01a/third_party/blink/renderer/modules/eventsource/event_source_parser_test.cc

    // single line
    let mut parser = EventStreamParser::new();
    // b"1".into() reports no impl for &[u8;1], but this is ok
    parser.push("data: value1\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "value1");
    // no additional trim
    parser.push("data:   value2   \n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "  value2   ");

    // discard no data
    let mut parser = EventStreamParser::new();
    parser.push("data:\n\n".into());
    assert_matches!(parser.pull(), Ok(None));
    let mut parser = EventStreamParser::new();
    // oh, multiple line data will make data buffer full of \ns, is this spec's empty string?
    parser.push("data: \ndata:\nid:\nevent:\ndata:\ndata: \n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "\n\n\n");

    // cut inside event
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(b""));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(b"data:1"));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "1");

    // multiple line
    let mut parser = EventStreamParser::new();
    parser.push("data:1\ndata: 234\ndata: 456   \n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "1\n234\n456   ");

    // multiple events, different kinds of eol by the way
    let mut parser = EventStreamParser::new();
    parser.push("data: message1\n\rdata: message2\r\ndata:message2line2\r\n\r\ndata:  message3\rdata:message3line2\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "message1");
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "message2\nmessage2line2");
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == " message3\nmessage3line2");

    // comment and other fields
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n :a field called empty\n  : a field called multiple whitespace\r\r\n".into());
    assert_matches!(parser.pull(), Ok(None));
    let mut parser = EventStreamParser::new();
    parser.push(": comment content\n\0:a field called NUL\n  : a field called multiple whitespace\rdata:hello\n\r\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "hello");

    // cjk
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好");
    let mut parser = EventStreamParser::new();
    parser.push("data: 你好\ndata: せかい\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好\nせかい");

    // cut in cjk
    //              0123456   7   8   9   10  11  1213    19  20  21  22  23  24  25  26  27  2829
    let encoded = b"data: \xe4\xbd\xa0\xe5\xa5\xbd\ndata: \xe3\x81\x9b\xe3\x81\x8b\xe3\x81\x84\n\n";
    let mut parser = EventStreamParser::new();
    parser.push(Bytes::from_static(&encoded[..10]));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(&encoded[10..23]));
    assert_matches!(parser.pull(), Ok(None));
    parser.push(Bytes::from_static(&encoded[23..]));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好\nせかい");
    // push one byte by one byte
    let mut parser = EventStreamParser::new();
    for b in encoded.into_iter().take(encoded.len() - 1) {
        parser.push(Bytes::copy_from_slice(&[*b]));
        assert_matches!(parser.pull(), Ok(None));
    }
    parser.push(Bytes::from_static(b"\n"));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "你好\nせかい");

    // now need to support event
    let mut parser = EventStreamParser::new();
    parser.push("event: delta1\ndata: value1\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == Some("delta1") && m.data == "value1");
    parser.push("data: value1.5\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == None && m.data == "value1.5");
    parser.push("event: event2\ndata: value2\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == Some("event2") && m.data == "value2");

    // overwrite event name
    let mut parser = EventStreamParser::new();
    parser.push("event: delta1\ndata: value1\revent:overwritten\n\n".into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.name.as_deref() == Some("overwritten") && m.data == "value1");
}

#[test]
fn test_event_stream_chat_completion() {
    use std::assert_matches;

    // nearly a real data
    let mut parser = EventStreamParser::new();
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1",choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"I"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"'ll"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" read"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" read"},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" the"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" file"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" for"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" the"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" file"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" for"},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" you"},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":" you"},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":"."},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tool-call-id-1","type":"function","function":{"name":"read-file","arguments":""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tool-call-id-1","type":"function","function":{"name":"read-file","arguments":""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"name"}}]},"logprobs":null,"finish_reason":null}]"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerp"#,
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"name"}}]},"logprobs":null,"finish_reason":null}]"#,
    ));
    assert_matches!(parser.pull(), Ok(None));

    parser.push(concat!(
        r#"rint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": "}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": "}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/main"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":".rs"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/main"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":".rs"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"logprobs":null,"finish_reason":null}]}"#,
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"logprobs":null,"finish_reason":null}]}"#,
    ));

    parser.push(concat!(
        r#"data: {"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":427,"#,
        r#"completion_tokens":47,"total_tokens":474,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":427}}"#,
        "\n\n",
        "data: [DONE]",
        "\n\n",
    ).into());
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == concat!(
        r#"{"id":"completion-id-1","object":"chat.completion.chunk","created":1792918070,"model":"deepseek-flash","system_fingerprint":""#,
        r#"system-fingerprint-1","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":427,"#,
        r#"completion_tokens":47,"total_tokens":474,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":427}}"#,
    ));
    assert_matches!(parser.pull(), Ok(Some(m)) if m.data == "[DONE]");
    assert_matches!(parser.pull(), Ok(None));

    parser.push("".into());
    assert_matches!(parser.pull(), Ok(None));
}

#[test]
fn test_event_stream_messages() {

    let full = r#"event: message_start
data: {"type":"message_start","message":{"id":"message-id1","type":"message","role":"assistant","model":"deepseek-flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}}

event: message_stop
data: {"type":"message_stop"}

"#;

    let mut parser = EventStreamParser::new();
    parser.push(full.into());
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_start"));
    assert_eq!(event.data, concat!(r#"{"type":"message_start","message":{"id":"message-id1","type":"message","role":"assistant","model":"deepseek-flash","#,
        r#""content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"service_tier":"standard"}}}"#));
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_start"));
    assert_eq!(event.data, r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("ping"));
    assert_eq!(event.data, r#"{"type":"ping"}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_delta"));
    assert_eq!(event.data, r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("content_block_stop"));
    assert_eq!(event.data, r#"{"type":"content_block_stop","index":0}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_delta"));
    assert_eq!(event.data, r#"{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3,"service_tier":"standard"}}"#);
    let event = parser.pull().expect("failed to pull?").expect("none?");
    assert_eq!(event.name.as_deref(), Some("message_stop"));
    assert_eq!(event.data, r#"{"type":"message_stop"}"#);
    assert!(parser.pull().expect("failed to pull?").is_none());
}
}
