
use std::fmt::{ Debug, Formatter, Result as FormatResult };
use std::io;

use super::parser::xml::common::{ TextPosition };

pub enum Error {
    // File IO
    FailOpenFile { inner_error: io::Error },

    // XML Parse
    FailParse { inner_error: super::parser::xml::reader::Error },
    InvalidFormat { position: TextPosition, element: String },

    UnexpectedPath,
    PathNodeNameNotSet,
    TargetsNotExist,
    TargetNotSet,
    TargetNotExist { target_name: String },
}

impl Debug for Error {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        match *self {
            Error::FailOpenFile{ ref inner_error } => {
                write!(f, "Failed to open config file: {}", inner_error)
            }
            Error::FailParse { ref inner_error } => {
                write!(f, "Failed to parse config file: {}", inner_error)
            }
            Error::InvalidFormat { ref position, ref element } => {
                write!(f, 
                    "Failed to parse config file: {} unexpected element `{}`", position, element)
            }
            Error::UnexpectedPath => {
                write!(f, "Unexpected path")
            }
            Error::PathNodeNameNotSet => {
                write!(f, "Path node name not set")
            }
            Error::TargetNotSet => {
                write!(f, "Target not set")
            }
            Error::TargetNotExist { ref target_name } => {
                write!(f, "Target not exist: {}", target_name)
            }
            _ => { write!(f, "Wait to check other availability") }
        }
    }
}