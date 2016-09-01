use std::fmt::{ Display, Formatter, Result as FormatResult };
use std::io::Error;

pub enum ConfigError<'a> {
    FailOpenFile { file_name: &'a str, inner_exception: Error },
}

impl<'a> Display for ConfigError<'a> {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        match *self {
            ConfigError::FailOpenFile{ file_name, .. } => {
                writeln!(f, "Failed to open file: {}", file_name)
            }
        }
    }
}