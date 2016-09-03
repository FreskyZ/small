
use std::path::{ PathBuf };

pub enum TargetAction {
    PathAdd(PathBuf),
    ScriptExecute(PathBuf),
}

pub enum Target<'a> {
    Actions(Vec<TargetAction>),
    AvailableNexts(Vec<&'a str>),
}
