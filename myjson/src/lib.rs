#![allow(dead_code)]
#![allow(unused_variables)]
#![allow(unused_imports)]

#[macro_use]
pub mod macros;

macro_rules! display_by_debug {
    ($t: ty) => (
        impl fmt::Display for $t {
            fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
                write!(f, "{:?}", self)
            }
        }
    )
}

mod error;
mod object;
mod value;
mod number;
mod serialize;
mod deserialize;

pub use object::Object;
pub use value::Value;
pub use number::Number;
pub use error::Error;
pub use serialize::from_string;
pub use deserialize::to_string;


#[cfg(test)]
mod tests {

    #[test]
    fn simple() {
        use std::fs::File;
        use std::io::Read;
        use super::from_string;
        use super::Value;
        use super::Object;
        use super::Number;

        let mut file = File::open("tests/1.json").unwrap();
        let mut buf = String::new();
        let _ = file.read_to_string(&mut buf).unwrap(); // just for panic at fail

        let value = from_string(buf).unwrap();
        assert_eq!(value, 
            array![
                "JSON Test Pattern pass1",
                object![
                    "object with 1 member" => array![ "array with 1 element", ],
                ],
                object![],
                array![],
                -42,
                true,
                false,
                null!(),
                object![
                    "integer" => 1234567890,
                    "real" => -9876.543210,
                    "e" => 0.123456789E-12,
                    "E" => 1.123456789E34,
                    "" => 23456789012E66,
                    "zero" => 0,
                    "one" => 1,
                    "emptystring" => "",
                    "space" => " ",
                    "quote" => "\"",
                    "backslash" => "\\",
                    "controls" => "\u{8}\u{C}\n\r\t",
                    "slash" => "/ & /",
                    "alpha" => "abcdefghijklmnopqrstuvwyz",
                    "ALPHA" => "ABCDEFGHIJKLMNOPQRSTUVWYZ",
                    "digit" => "0123456789",
                    "0123456789" => "digit",
                    "special" => "`1~!@#$%^&*()_+-={':[,]}|;.</>?",
                    "hex" => "\u{123}\u{4567}\u{89AB}\u{CDEF}\u{abcd}\u{ef4A}",
                    "true" => true,
                    "false" => false,
                    "null" => null!(),
                    "array" => array![],
                    "object" => object![],
                    "address" => "50 St. James Street",
                    "url" => "ttp://www.JSON.org/",
                    "comment" => "// /* <!-- --",
                    "# -- --> */" => " ",
                    " s p a c e d " => array![1, 2, 3, 4, 5, 6, 7, ],
                    "compact" => array![1, 2, 3, 4, 5, 6, 7, ],
                    "jsontext" => "{\"object with 1 member\":[\"array with 1 element\"]}",
                    "diffescapes" => "&#34; \u{0022} %22 0x22 034 &#x22;",
                    "/\\\"\u{CAFE}\u{BABE}\u{AB98}\u{FCDE}\u{bcda}\u{ef4A}\u{8}\u{C}\n\r\t`1~!@#$%^&*()_+-=[]{}|;:',./<>?" => "A key can be any string", 
                ],
                0.5, 
                98.6,
                99.4,
                1066,
                1,
                0.1,
                0.1,
                1,
                2,
                2,
                "rosebud",
            ]
        );
    }
}
