
use value::Value;

#[derive(Eq, PartialEq)]
pub struct Object {
    pairs: Vec<(String, Value)>
}

const INDENT : [&'static str; 10] = ["", "    ", "        ", "            ", "                ", "                    ", "                          ", 
    "                              ", "                                  ", "                                      "];
impl Object {
    pub fn new() -> Object {
        Object { pairs: Vec::new() }
    }

    pub fn format(&self, depth: usize, inline: bool) -> String {

        let mut ret_val = format!("{}{{ ", INDENT[depth]);
        if self.pairs.len() == 0 {
            ret_val.push_str("}");
            return ret_val;
        }

        let inline = inline || self.flat_len() + depth * 4 < 80; // can inline
        for pair in &self.pairs {
            let inner_inline = inline || Self::pair_len(pair) + depth * 4 + 2 < 80;
            ret_val.push_str(
                &format!("{}{:?}: {}, ", 
                    if inline { "".to_owned() } else { format!("\n{}", INDENT[depth + 1]) }, 
                    pair.0, 
                    pair.1.format( if inner_inline { 0 } else { depth + 1 }, inner_inline)));
        }
        ret_val.push_str(&format!("\u{8}\u{8}{}}}", if inline { " ".to_owned() } else { format!("\n{}", INDENT[depth]) }));
        ret_val
    }

    fn pair_len(pair: &(String, Value)) -> usize {
        // `"..."`,             `: `,                   `, `
        2_usize + pair.0.len() + 2 + pair.1.flat_len() + 2
    }

    pub fn flat_len(&self) -> usize {
        // `{ "name1": "value1", "name2": {:?} }`'s length
        self.pairs.iter().fold(2_usize, |sum, ref pair| sum + Self::pair_len(pair)) 
    }
}

use std::ops;
impl<'a> ops::Index<&'a str> for Object {
    type Output = Value;

    fn index(&self, index: &'a str) -> &Value {
        &self.pairs[0].1
    }
}

impl<'a> ops::IndexMut<&'a str> for Object {

    fn index_mut(&mut self, index: &'a str) -> &mut Value {
        &mut self.pairs[0].1
    }
}

impl From<Vec<(String, Value)>> for Object {
    fn from(pairs: Vec<(String, Value)>) -> Object {
        Object { pairs: pairs }
    }
}

use std::fmt;
impl fmt::Debug for Object {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}\n", self.format(0, false))
    }
}

display_by_debug!(Object);