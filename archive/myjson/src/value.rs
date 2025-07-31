
use object::Object;
use number::Number;

#[derive(Eq, PartialEq)]
pub enum Value {
    Object(Object),
    Array(Vec<Value>),
    Number(Number),
    String(String),
    Boolean(bool),
    Null,
}

const INDENT : [&'static str; 10] = ["", "    ", "        ", "            ", "                ", "                    ", "                          ", 
    "                              ", "                                  ", "                                      "];
impl Value {

    pub fn new() -> Value {
        Value::Null
    }

    // Length after format without any CRLF and nonnecessary spaces
    pub fn flat_len(&self) -> usize {
        match *self {
            Value::Null => 4,
            Value::Boolean(true) => 4,
            Value::Boolean(false) => 5,
            Value::Number(ref number) => number.len(),
            Value::String(ref string) => string.len() + 2,
            
            Value::Object(ref object) => object.flat_len(),
            Value::Array(ref array) => array.iter().fold(2_usize, |sum, ref value| sum + value.flat_len()),
        }
    }

    pub fn format(&self, depth: usize, inline: bool) -> String {
        let mut ret_val = String::new();
        let indent = if inline { "" } else { INDENT[depth] }; 
        match *self {
            Value::Null => ret_val.push_str(&format!("{}null", indent)),
            Value::Boolean(boolean) => ret_val.push_str(&format!("{}{:?}", indent, boolean)),
            Value::Number(ref number) => ret_val.push_str(&format!("{}{:?}", indent, number)),
            Value::String(ref string) => ret_val.push_str(&format!("{}{:?}", indent, string)),

            Value::Object(ref object) => ret_val.push_str(&object.format(depth, inline)),
            Value::Array(ref array) => {
                if array.len() == 0 { // assume length = 0 always inline
                    ret_val.push_str(&format!("{}[ ]", indent));
                    return ret_val;
                }
                
                // always indent as outter level need
                let inline = inline || self.flat_len() + depth * 4 < 80;
                if !inline { ret_val.push_str(&format!("\n{}", indent)); }
                ret_val.push_str(&format!("["));

                for value in array {
                    if !inline { ret_val.push_str("\n"); }
                    ret_val.push_str(&format!("{}, ", value.format(depth + 1, inline)));
                }
                ret_val.push_str("\u{8}\u{8}");
                if !inline { ret_val.push_str(&format!("\n{}", indent)); }
                ret_val.push_str(&format!("]"));
            }
        }
        ret_val
    }

    pub fn from_string(text: String) -> Value {
        Value::Null
    }
}

// From impl for macros
impl From<String> for Value {
    fn from(string: String) -> Value {
        Value::String(string)
    }
}
impl<'a> From<&'a str> for Value {
    fn from(string: &'a str) -> Value {
        Value::String(string.to_owned())
    }
}
impl From<i64> for Value {
    fn from(val: i64) -> Value {
        Value::Number(Number::from(val))
    }
}impl From<i32> for Value {
    fn from(val: i32) -> Value {
        Value::Number(Number::from(val))
    }
}
impl From<u64> for Value {
    fn from(val: u64) -> Value {
        Value::Number(Number::from(val))
    }
}
impl From<f64> for Value {
    fn from(val: f64) -> Value {
        Value::Number(Number::from(val))
    }
}
impl From<bool> for Value {
    fn from(val: bool) -> Value {
        Value::Boolean(val)
    }
}

use std::fmt;
impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}\n", self.format(0, false))
    }
}

display_by_debug!(Value);