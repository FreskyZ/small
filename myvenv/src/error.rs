
use std::fmt::{ Debug, Display, Formatter, Result as FormatResult };
use std::io;
use std::env;

use xml;
use xml::common::TextPosition;

#[allow(non_camel_case_types)]
#[allow(dead_code)]
pub enum Error {
    // Arg parse
    InvalidArgument { arg: String },

    // File IO
    FailOpenFile { file_name: String, e: io::Error },

    // XML Parse
    FailParse { e: xml::reader::Error },
    InvalidFormat { 
        position: TextPosition, 
        element: String },

    // Get target action
    InvalidPath { path: String },
    PathNodeNotFound { 
        path: String, 
        correct_part: String,
        incorrect_node: String,
        is_invalid: bool, // No target and no children
        nodes_available: Vec<String> 
    },
    TargetNotSet { 
        path: String, 
        path_node_pos: TextPosition,
        nodes_available: Vec<String>, 
    },  // if available is empty, also remind invalid pathnode
    TargetNotExist { 
        path: String, 
        target_name: String, 
        target_config_pos: TextPosition 
    }, // also remind empty action target is abandoned

    // Apply
    EnvironmentVariableSystemCallError { e: env::VarError },
    EnvironmentVariableOperationError { e: env::JoinPathsError },
    TemporaryFileOperationError { e: io::Error },
    ProcessError { e: io::Error },

    // Other
    UnexpectedInternalError_ReachUnexpectedInternalState,
    UnexpectedInternalError_GetUnexpectedResult,
    UnexpectedInternalError_AvailableNextsCannotCombine,
}

impl Debug for Error {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        match *self {

            Error::InvalidArgument { ref arg } => {
                write!(f, "Invalid argument: {}", arg)
            }

            Error::FailOpenFile { ref file_name, ref e } => {
                write!(f, "Failed to open config file `{}`: {}", file_name, e)
            }

            Error::FailParse { ref e } => {
                write!(f, "Failed to parse config file: {}", e)
            }
            Error::InvalidFormat { ref position, ref element } => {
                write!(f, 
                    "Failed to parse config file: {} unexpected element `{}`",
                    position, element)
            }
            
            Error::InvalidPath { ref path } => {
                write!(f, "Path `{}` has invalid format", path)
            }
            Error::PathNodeNotFound { ref path, ref correct_part, ref incorrect_node, ref is_invalid, ref nodes_available } => {
                try!(write!(f, "Path node not found for path `{}`: no `{}` after `{}`", path, incorrect_node, correct_part));
                if *is_invalid {
                    try!(write!(f, ", this node contains no child with no target set, consider remove or reconfigure it"));
                } else {
                    try!(writeln!(f, ", available nodes: "));
                    for node in nodes_available {
                        try!(writeln!(f, "    {}", node));
                    }
                }
                Ok(())
            }
            Error::TargetNotSet { ref path, ref path_node_pos, ref nodes_available } => {
                try!(write!(f, "Target not set for path `{}` at {}", path, path_node_pos));
                if nodes_available.len() == 0 {
                    try!(write!(f, ", this node contains no child with no target set, consider remove or reconfigure it"));
                } else {
                    try!(writeln!(f, ", consider set target or continue the path with: "));
                    for node in nodes_available {
                        try!(writeln!(f, "    {}", node));
                    }
                }
                Ok(())
            }
            Error::TargetNotExist { ref path, ref target_name, ref target_config_pos } => {
                write!(f, 
                    "Target not exist for path `{}` which configured target name `{}` at {}, note that empty targets are ignored", 
                    path, target_name, target_config_pos)
            }

            Error::EnvironmentVariableSystemCallError { ref e } => {
                write!(f, "Environment variable system call error: {}", e)
            }
            Error::EnvironmentVariableOperationError { ref e } => {
                write!(f, "Environment variable operation error: {}", e)
            }
            Error::TemporaryFileOperationError { ref e } => {
                write!(f, "Temporary file operation error: {}", e)
            }
            Error::ProcessError { ref e } => {
                write!(f, "Process not spawned: {}", e)
            }

            Error::UnexpectedInternalError_ReachUnexpectedInternalState => {
                write!(f, "Unexpected internal error: reach unexpected internal state")
            }
            Error::UnexpectedInternalError_GetUnexpectedResult => {
                write!(f, "Unexpected internal error: get unexpected result")
            }
            Error::UnexpectedInternalError_AvailableNextsCannotCombine => {
                write!(f, "Unexpected internal error: available nexts cannot combine")
            }
        }
    }
}

impl Display for Error {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        write!(f, "{:?}", self)
    }
}

#[cfg(all(test, someverycomplex))]
#[test]
fn error_f() {
    perrorln!("123456\n789\u{8}\u{8}a");
}