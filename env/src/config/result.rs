
use std::fmt::{ self, Debug, Formatter };

#[derive(Debug, Eq, PartialEq, Clone)]
pub enum TargetAction {
    PathAdd(String),
    ScriptExecute(String),
}

#[derive(Eq, PartialEq)]
pub enum ConfigResult {
    Actions(Vec<TargetAction>),
    AvailablePathNodes(Vec<String>),
}

impl Debug for ConfigResult {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        match *self {
            ConfigResult::Actions(ref actions) => {
                for action in actions {
                    match action {
                        &TargetAction::PathAdd(ref value) => { try!(write!(f, "PathAdd: {:?}", value)); },
                        &TargetAction::ScriptExecute(ref value) => { try!(write!(f, "ScriptExecute: {:?}", value)); }
                    }
                }
            }
            ConfigResult::AvailablePathNodes(ref path_nodes) => {
                try!(writeln!(f, "Available nexts: {:?}", path_nodes));
            }
        }
        Ok(())
    }
}