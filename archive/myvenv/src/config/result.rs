
use std::collections::HashMap;
use std::fmt::{ Debug, Display, Formatter, Result as FormatResult };

use error::Error;

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

#[derive(Eq, PartialEq, Hash)]
pub struct MergedVarAdd {
    pub var: String,
    pub values: Vec<String>,
}

impl Debug for MergedVarAdd {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        try!(writeln!(f, "Add to `{}`", self.var)) ;
        for value in &self.values {
            try!(writeln!(f, "    {}", value));
        }
        Ok(())
    }
}

impl MergedVarAdd {
    pub fn new_path() -> MergedVarAdd {
        MergedVarAdd { var: "PATH".to_owned(), values: Vec::new() }
    }
    pub fn new_path_with_value(values: Vec<String>) -> MergedVarAdd {
        MergedVarAdd { var: "PATH".to_owned(), values: values }
    }
}

#[derive(Eq, PartialEq)]
pub struct MergedResult {
    pub vars: Vec<MergedVarAdd>,
    pub paths: MergedVarAdd,
    pub scripts: Vec<String>,
}

impl MergedResult {
    pub fn new() -> MergedResult {
        MergedResult { vars: Vec::new(), paths: MergedVarAdd::new_path(), scripts: Vec::new() }
    }
}

impl Debug for MergedResult {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        try!(writeln!(f, "Add vars: "));
        for addvar in &self.vars {
            try!(writeln!(f, "{:?}", addvar));
        }
        try!(writeln!(f, "Add to `PATH`: "));
        for path in &self.paths.values {
            try!(writeln!(f, "    {}", path));
        }
        try!(writeln!(f, "Execute script: "));
        for script in &self.scripts {
            try!(writeln!(f, "    {}", script));
        }
        Ok(())
    }
}

impl ConfigResult {

    // Otherwise merge to varadd map and script list
    // Attention that values in a mergedadd and scripts in scripts is reversed,
    // It is designed that they are processed in reverse order later to keep the initial order
    pub fn merge(results: Vec<ConfigResult>) -> Result<MergedResult, Error> {
        
        if results.len() == 0 {
            return Ok(MergedResult::new());
        }

        let mut scripts = Vec::new();
        let mut paths = Vec::new();
        let mut varadds = HashMap::<String, Vec<String>>::new();

        let mut results = results;
        for _ in 0..results.len() {
            match results.pop().unwrap() {
                ConfigResult::Actions(mut actions) => {
                    for _ in 0..actions.len() {
                        match actions.pop().unwrap() {
                            TargetAction::PathAdd(value) => {
                                paths.push(value);
                            }
                            TargetAction::VariableAdd(var, value) => {
                                varadds.entry(var).or_insert(Vec::new()).push(value);
                            }
                            TargetAction::ScriptExecute(path) => {
                                scripts.push(path);
                            }
                        }
                    }
                }
                ConfigResult::AvailablePathNodes(..) => {
                    return Err(Error::UnexpectedInternalError_AvailableNextsCannotCombine);
                }
            }
        }

        let mut merged_adds = Vec::new();
        for (key, value) in varadds {
            merged_adds.push(MergedVarAdd { var: key, values: value });
        }

        Ok(MergedResult { vars: merged_adds, paths: MergedVarAdd::new_path_with_value(paths), scripts: scripts })
    }
}

impl Debug for ConfigResult {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        try!(writeln!(f, ""));
        match *self {
            ConfigResult::Actions(ref actions) => {
                for action in actions {
                    match action {
                        &TargetAction::PathAdd(ref value) => { try!(writeln!(f, "PathAdd: {}", value)); },
                        &TargetAction::ScriptExecute(ref value) => { try!(writeln!(f, "ScriptExecute: {}", value)); }
                        &TargetAction::VariableAdd(ref var, ref value) => { try!(writeln!(f, "VarAdd: {}={}", var, value)); }
                    }
                }
            }
            ConfigResult::AvailablePathNodes(ref path_nodes) => {
                for next in path_nodes {
                    try!(writeln!(f, "    {}", next));
                }
            }
        }
        Ok(())
    }
}

impl Display for ConfigResult {
    fn fmt(&self, f: &mut Formatter) -> FormatResult {
        write!(f, "{:?}", self)
    }
}

#[cfg(test)]
mod tests {
    
    #[test]
    pub fn result_merge() {

        use std::collections::HashSet;

        use error::Error;

        use super::ConfigResult;
        use super::ConfigResult::*;
        use super::TargetAction::*;
        use super::MergedVarAdd;
        use super::MergedResult;

        macro_rules! path {
            ($value: expr) => (PathAdd($value.to_owned()))
        }
        macro_rules! script {
            ($path: expr) => (ScriptExecute($path.to_owned()))
        }
        macro_rules! varadd {
            ($var: expr, $value: expr) => (VariableAdd($var.to_owned(), $value.to_owned()))
        }
        macro_rules! action {
            [$($action: tt)*] => (Actions(vec![$($action)*]))
        }

        macro_rules! mergedadd {
            ($var: expr, $($values: tt)*) => (MergedVarAdd { var: $var.to_owned(), 
                values: vec![$($values)*].into_iter().map(|s| s.to_owned()).collect() })
        }        
        macro_rules! mergedadd_path {
            ($($values: tt)*) => (MergedVarAdd { var: "PATH".to_owned(), 
                values: vec![$($values)*].into_iter().map(|s| s.to_owned()).collect() })
        }
        macro_rules! mergedscript {
            ($path: expr) => ($path.to_owned())
        }

        // Normal
        match ConfigResult::merge(vec![
            action![path!("123"), script!("456"), varadd!("789", "101112")],
            action![script!("404142"), path!("161718"), path!("192021"), varadd!("789", "222324"), varadd!("252627", "282930")],
            action![varadd!("313233", "343536"), varadd!("313233", "373839"), script!("131415"), varadd!("789", "434445")],
            action![path!("474849")],
            action![path!("505152")]
        ]) {
            Ok(MergedResult { vars, paths, scripts }) => {
                assert_eq!(vars.into_iter().collect::<HashSet<MergedVarAdd>>(), vec![
                    mergedadd!("252627", "282930"),
                    mergedadd!("313233", "373839", "343536"),
                    mergedadd!("789", "434445", "222324", "101112"),
                ].into_iter().collect::<HashSet<MergedVarAdd>>()); 
                assert_eq!(paths, mergedadd_path!("505152", "474849", "192021", "161718", "123"));
                assert_eq!(scripts, vec![
                    mergedscript!("131415"),
                    mergedscript!("404142"),
                    mergedscript!("456"),
                ]);
            }
            Err(e) => panic!("Unexpeted error: {}", e),
        }

        // Empty
        match ConfigResult::merge(Vec::new()) {
            Ok(merged) => assert_eq!(merged, MergedResult::new()),
            Err(e) => panic!("Unexpected error: {}", e),
        };

        // Internal error
        match ConfigResult::merge(vec![
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
            Err(Error::UnexpectedInternalError_AvailableNextsCannotCombine) => perrorln!("Get expected error"), 
            Err(e) => panic!("Unexpected other error: {}", e),
        }
    }
}