
use std::path::{ PathBuf };

pub enum TargetAction {
    PathAdd(PathBuf),
    ScriptExecute(PathBuf),
}

pub struct Target {
    actions: Vec<TargetAction>,
}

impl Target {

    pub fn new() -> Target {
        Target { actions: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.actions.len()
    }
}