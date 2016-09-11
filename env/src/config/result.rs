
use std::fmt::{ self, Debug, Formatter };

use super::error::Error;

#[derive(Debug, Eq, PartialEq, Clone)]
pub enum TargetAction {
    PathAdd(String),
    ScriptExecute(String),
    VariableAdd(String, String),
}

#[derive(Eq, PartialEq)]
pub enum ConfigResult {
    Actions(Vec<TargetAction>),
    AvailablePathNodes(Vec<String>),
}

impl ConfigResult {

    // Actions(Vec::new()) for empty, UnexpectedInternalError_GetUnexpectedResult for different types
    // Otherwise combine
    pub fn combine(results: Vec<ConfigResult>) -> Result<ConfigResult, Error> {
        
        if results.len() == 0 {
            return Ok(ConfigResult::Actions(Vec::new()));
        }

        let mut results = results;
        match results.pop().unwrap() {
            ConfigResult::Actions(mut ret_val) => {

                for _ in 0..results.len() {
                    match results.pop().unwrap() {
                        ConfigResult::Actions(mut actions) => {
                            for _ in 0..actions.len() {
                                ret_val.push(actions.pop().unwrap());
                            }
                        }
                        ConfigResult::AvailablePathNodes(..) => {
                            return Err(Error::UnexpectedInternalError_GetUnexpectedResult);
                        }
                    }
                }

                Ok(ConfigResult::Actions(ret_val.into_iter().rev().collect()))
            }
            ConfigResult::AvailablePathNodes(mut ret_val) => {

                for _ in 0..results.len() {
                    match results.pop().unwrap() {
                        ConfigResult::AvailablePathNodes(mut nodes) => {
                            for _ in 0..nodes.len() {
                                ret_val.push(nodes.pop().unwrap());
                            }
                        }
                        ConfigResult::Actions(..) => {
                            return Err(Error::UnexpectedInternalError_GetUnexpectedResult);
                        }
                    }
                }

                Ok(ConfigResult::AvailablePathNodes(ret_val.into_iter().rev().collect()))
            }
        }
    }
}

impl Debug for ConfigResult {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        try!(writeln!(f, ""));
        match *self {
            ConfigResult::Actions(ref actions) => {
                for action in actions {
                    match action {
                        &TargetAction::PathAdd(ref value) => { try!(writeln!(f, "PathAdd: {:?}", value)); },
                        &TargetAction::ScriptExecute(ref value) => { try!(writeln!(f, "ScriptExecute: {:?}", value)); }
                        &TargetAction::VariableAdd(ref var, ref value) => { try!(writeln!(f, "VarAdd: {:?}={:?}", var, value)); }
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

#[cfg(test)]
mod tests {
    
    #[test]
    pub fn result_combine() {

        use super::super::error::Error;

        use super::ConfigResult;
        use super::ConfigResult::*;
        use super::TargetAction::*;

        let combined = match ConfigResult::combine(vec![
            AvailablePathNodes(vec!["123".to_owned(), "456".to_owned()]), 
            AvailablePathNodes(vec!["789".to_owned(), "123".to_owned()]),
            AvailablePathNodes(vec!["101112".to_owned()])
        ]) {
            Ok(combined) => combined,
            Err(e) => panic!("Unexpected error: {}", e),
        };
        assert_eq!(combined, AvailablePathNodes(vec!["123".to_owned(), "456".to_owned(), "789".to_owned(), "123".to_owned(), "101112".to_owned()]));

        let combined = match ConfigResult::combine(vec![
            Actions(vec![
                PathAdd("123".to_owned()), 
                ScriptExecute("456".to_owned()),
                VariableAdd("var2".to_owned(),"789".to_owned())
            ]),
            Actions(vec![
                VariableAdd("var1".to_owned(), "101112".to_owned()),
                ScriptExecute("456".to_owned()),
            ]),
            Actions(vec![
                PathAdd("131415".to_owned())
            ])
        ]) {
            Ok(combined) => combined,
            Err(e) => panic!("Unexpected error: {}", e),
        };
        assert_eq!(combined, Actions(vec![
            PathAdd("123".to_owned()), 
            ScriptExecute("456".to_owned()),
            VariableAdd("var2".to_owned(),"789".to_owned()),
            VariableAdd("var1".to_owned(), "101112".to_owned()),
            ScriptExecute("456".to_owned()),
            PathAdd("131415".to_owned())
        ]));

        let combined = match ConfigResult::combine(Vec::new()) {
            Ok(combined) => combined,
            Err(e) => panic!("Unexpected error: {}", e),
        };
        assert_eq!(combined, ConfigResult::Actions(Vec::new()));

        match ConfigResult::combine(vec![
            Actions(vec![
                PathAdd("123".to_owned()), 
                ScriptExecute("456".to_owned()),
            VariableAdd("var2".to_owned(),"789".to_owned()),
            ]),
            AvailablePathNodes(vec!["123".to_owned(), "456".to_owned()]), 
            AvailablePathNodes(vec!["789".to_owned(), "123".to_owned()]),
            Actions(vec![
            VariableAdd("var1".to_owned(), "101112".to_owned()),
                ScriptExecute("456".to_owned()),
            ]),
            AvailablePathNodes(vec!["101112".to_owned()]),
            Actions(vec![
                PathAdd("131415".to_owned())
            ])
        ]) {
            Ok(_) => panic!("Unexpected succeed"),
            Err(Error::UnexpectedInternalError_GetUnexpectedResult) => perrorln!("Get expected error"), 
            Err(e) => panic!("Unexpected other error: {}", e),
        }
    }
}