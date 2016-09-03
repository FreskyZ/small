
use std::fmt::{ self, Debug, Formatter };

pub enum TargetAction {
    PathAdd(String),
    ScriptExecute(String),
}

pub struct Target {
    pub actions: Vec<TargetAction>
}

impl Target {
    pub fn push_path(&mut self, path: &str) {
        self.actions.push(TargetAction::PathAdd(path.to_owned()));
    }
    pub fn push_script(&mut self, script: &str) {
        self.actions.push(TargetAction::ScriptExecute(script.to_owned()));
    }
}

impl Debug for Target {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        for action in &self.actions {
            match action {
                &TargetAction::PathAdd(ref value) => { let _ = writeln!(f, "PathAdd: {:?}", value); },
                &TargetAction::ScriptExecute(ref value) => { let _ = writeln!(f, "ScriptExecute: {:?}", value); }
            }
        }
        Ok(())
    }
}