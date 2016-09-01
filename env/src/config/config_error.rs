use std::fmt::{ Display, Formatter, Result as FormatResult };
use std::io::Error;

pub enum ConfigError {
    FailOpenFile { inner_exception: Error },
}

impl Display for ConfigError {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        match *self {
            ConfigError::FailOpenFile{ ref inner } => {
                writeln!(f, "Failed to open config file: {}", inner)
            }
        }
    }
}