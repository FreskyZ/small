
mod error;
mod result;
mod parser;

use self::parser::{ PathNode, ConfigEvent, ConfigParser };
use self::parser::xml::common::TextPosition;

pub use self::error::Error;
pub use self::result::{ TargetAction, ConfigResult };

#[derive(Debug)]
enum State<'a> {
    WaitingPaths,
    SearchingPathNode {
        expect_depth: usize,    
        expect_value: &'a str,
    },
    RecordingAvailables {
        expect_depth: usize, 
        ret_val: Vec<String>,
    },
    ErrorRecordingAvailables {
        expect_depth: usize,
        ret_val: Vec<String>,
    },
    WaitingTargets {
        target_name: String,
        target_config_pos: TextPosition,
    },
    SearchingTarget {
        target_name: String,
        target_config_pos: TextPosition,
    },
}

enum MaybeReturn<'a> {
    State(State<'a>),
    Return(Result<ConfigResult, Error>),
}

impl<'a> State<'a> {

    fn start_paths(self, split_path: &Vec<&'a str>) -> Self {
        match self {
            State::WaitingPaths => {
                if split_path.len() > 0 {
                    State::SearchingPathNode::<'a> { expect_depth: 0, expect_value: split_path[0] }
                } else {
                    State::RecordingAvailables { expect_depth: 0, ret_val: Vec::new() }
                }
            },
            _ => self
        }
    }

    fn start_p(self, inner: PathNode, split_path: &'a Vec<&str>, require_list: bool, parser_position: TextPosition) -> Self {
         match self {
            State::SearchingPathNode { expect_depth, expect_value } => {
                if inner.depth == expect_depth && inner.has(expect_value) {
                    if split_path.len() > inner.depth + 1 {
                        return State::SearchingPathNode { 
                            expect_depth: expect_depth + 1, 
                            expect_value: split_path[inner.depth + 1], 
                        };
                    } else {
                        if require_list {
                            return State::RecordingAvailables { 
                                expect_depth: expect_depth + 1, 
                                ret_val: Vec::new() 
                            };
                        } else {
                            match inner.target {
                                Some(target) => {
                                    return State::WaitingTargets { 
                                        target_name: target,
                                        target_config_pos: parser_position, 
                                    };
                                }
                                None => {
                                    return State::ErrorRecordingAvailables { 
                                        expect_depth: expect_depth + 1, 
                                        ret_val: Vec::new() 
                                    };
                                }
                            }
                        }
                    }
                }
                State::SearchingPathNode { expect_depth: expect_depth, expect_value: expect_value }
            }
            State::RecordingAvailables { expect_depth, mut ret_val } => {
                if inner.depth == expect_depth { 
                    ret_val.push(inner.to_string());
                }
                return State::RecordingAvailables { expect_depth: expect_depth, ret_val: ret_val };
            }
            State::ErrorRecordingAvailables { expect_depth, mut ret_val } => {
                if inner.depth == expect_depth { 
                    ret_val.push(inner.to_string());
                }
                return State::ErrorRecordingAvailables { expect_depth: expect_depth, ret_val: ret_val };
            }
            _ => self
        }
    }

    fn end_p(self, depth: usize, full_path: &str, parser_position: TextPosition) -> MaybeReturn<'a> {
        match self {
            State::RecordingAvailables { expect_depth, ret_val } => {
                if expect_depth == depth + 1 {
                    // Out of recording area, return
                    return MaybeReturn::Return(
                        Ok(ConfigResult::AvailablePathNodes(ret_val)));
                }
                return MaybeReturn::State(
                    State::RecordingAvailables { expect_depth: expect_depth, ret_val: ret_val });
            }                    
            State::ErrorRecordingAvailables { expect_depth, ret_val } => {
                if expect_depth == depth + 1 {
                    return MaybeReturn::Return(Err(
                        Error::TargetNotSet { path: full_path.to_owned(), nodes_available: ret_val, path_node_pos: parser_position }));   
                }
                return MaybeReturn::State(
                    State::ErrorRecordingAvailables { expect_depth: expect_depth, ret_val: ret_val });
            }
            // State::SearchingPathNode { .. } => {
            // }
            _ => MaybeReturn::State(self),
        }
    }

    fn end_paths(self, full_path: &str, parser_position: TextPosition) -> MaybeReturn<'a> {
        match self {
            State::RecordingAvailables { expect_depth: _1, ret_val } => {
                return MaybeReturn::Return(Ok(ConfigResult::AvailablePathNodes(ret_val)));                               
            },
            State::ErrorRecordingAvailables { expect_depth: _1, ret_val } => {
                return MaybeReturn::Return(Err(Error::TargetNotSet { 
                    path: full_path.to_owned(), 
                    nodes_available: ret_val, 
                    path_node_pos: parser_position,
                }));                                
            },
            State::SearchingPathNode { expect_depth: ref _1, expect_value: ref _2 } => {
                return MaybeReturn::Return(Err(Error::PathNodeNotFound { 
                    path: full_path.to_owned(), 
                    correct_part: "2".to_owned(), 
                    incorrect_node: "3".to_owned(), 
                    is_invalid: false, 
                    nodes_available: Vec::new() 
                }));
            }
            _ => MaybeReturn::State(self),
        }
    }

    fn start_targets(self) -> Self {
        match self {
            State::WaitingTargets { target_name, target_config_pos } => {
                State::SearchingTarget { target_name: target_name, target_config_pos: target_config_pos }
            }
            _ => self
        }
    }

    fn target(self, current_name: String, actions: Vec<TargetAction>) -> MaybeReturn<'a> {
        match self {
            State::SearchingTarget { target_name, target_config_pos } => {
                if current_name == target_name {
                    return MaybeReturn::Return(Ok(ConfigResult::Actions(actions)));
                }
                return MaybeReturn::State(State::SearchingTarget { target_name: target_name, target_config_pos: target_config_pos });
            }
            _ => MaybeReturn::State(self),
        }
    }

    fn end_targets(self, full_path: &str) -> MaybeReturn<'a> {
        match self {
            State::WaitingTargets { target_name, target_config_pos } => {
                return MaybeReturn::Return(Err(
                    Error::TargetNotExist { 
                        path: full_path.to_owned(), 
                        target_name: target_name.to_owned(), 
                        target_config_pos: target_config_pos 
                }));
            }
            State::SearchingTarget { target_name, target_config_pos } => {
                return MaybeReturn::Return(Err(
                    Error::TargetNotExist { 
                        path: full_path.to_owned(), 
                        target_name: target_name.to_owned(), 
                        target_config_pos: target_config_pos 
                }));
            }
            _ => MaybeReturn::State(self),
        }
    }
}

// vec![] for "", error for "...//..."
fn split_path(full_path: &str) -> Result<Vec<&str>, Error> {

    if full_path.is_empty() {
        Ok(Vec::new())
    } else {
        let splitted = full_path.split('/').collect::<Vec<&str>>();
            
        let mut valid = true;
        for i in 0..splitted.len() {
            if splitted[i] == "" {
                valid = false;
            }
        }

        if valid {
            Ok(splitted)
        } else {
            return Err(Error::InvalidPath { path: full_path.to_owned() });
        }
    }
}

const INDENT: [&'static str; 7] 
    = ["", "   ", "      ", "         ", "            ", "               ", "                    "];
pub fn get_target(file_name: &str, full_path: &str, require_list: bool) -> Result<ConfigResult, Error> {

    let split_path = try!(split_path(full_path));
    let mut parser = try!(ConfigParser::from(file_name));

    let mut state = State::WaitingPaths;
    loop {
        match parser.next() {
            // Path
            Some(ConfigEvent::StartPaths) => {
                //perrorln!("StartPaths");
                state = state.start_paths(&split_path);
            },
            Some(ConfigEvent::StartP { inner }) => {
                //perrorln!("{:?}\n{}state {:?}", inner, INDENT[inner.depth], state);
                state = state.start_p(inner, &split_path, require_list, parser.position());
            },
            Some(ConfigEvent::EndP { depth }) => {
                //perrorln!("{}EndP\n{}state: {:?}", INDENT[current_depth], INDENT[current_depth], state);
                match state.end_p(depth, full_path, parser.position()) {
                    MaybeReturn::State(new_state) => { state = new_state; }
                    MaybeReturn::Return(ret_val) => { return ret_val; }
                }
            },
            Some(ConfigEvent::EndPaths) => {
                //perrorln!("EndPaths");
                match state.end_paths(full_path, parser.position()) {
                    MaybeReturn::State(new_state) => { state = new_state; }
                    MaybeReturn::Return(ret_val) => { return ret_val; }
                }
            },

            // State
            Some(ConfigEvent::StartTargets) => {
                state = state.start_targets();
            },
            Some(ConfigEvent::Target { name, actions }) => {
                match state.target(name, actions) {
                    MaybeReturn::State(new_state) => { state = new_state; }
                    MaybeReturn::Return(ret_val) => { return ret_val; }
                }
            },
            Some(ConfigEvent::EndTargets) => {
                match state.end_targets(full_path) {
                    MaybeReturn::State(new_state) => { state = new_state; }
                    MaybeReturn::Return(ret_val) => { return ret_val; }
                }
            },

            // Other
            Some(ConfigEvent::XMLReaderError { e }) => return Err(e),
            None => return Err(Error::UnexpectedInternalError), // If all correct, will not goto end document
        }
    }
}

#[cfg(test)]
mod tests {

    #![allow(unused_imports)]

    use super::get_target;
    use super::ConfigResult;
    use super::TargetAction::*;
    use super::parser::{ ConfigEvent, ConfigParser };
    use super::error::Error;
    use super::parser::xml::common::{ Position, TextPosition };

    #[test]
    fn get_targets() {
        
        macro_rules! test_case {
            ($full_path: expr, $req: expr, actions: [$($actions:tt)*]) => (
                match get_target(".env", $full_path, $req) {
                    Ok(ConfigResult::Actions(actions)) => {
                        assert_eq!(actions, vec![$($actions)*]);
                    }
                    Ok(_) => unreachable!(),
                    Err(e) => panic!("{:?}", e),
                }
            );
            
            ($full_path: expr, $req: expr, nexts: [$($nexts:tt)*]) => (
                match get_target(".env", $full_path, $req) {
                    Ok(ConfigResult::AvailablePathNodes(nexts)) => {
                        assert_eq!(nexts, vec![$($nexts)*]);
                    }
                    Ok(_) => unreachable!(),
                    Err(e) => panic!("{:?}", e),
                }
            )
        }

        test_case!("msvc/19", true, 
            nexts: ["m32(x86)", "m64(amd64, x64)"]);
        test_case!("", true,
            nexts: ["gcc(gnuc)", "git", "haskell(hs)", "java", "lua", "nasm", 
                ".net(dotnet, netfx, netframework)", "vcpp(msvc)", "python(py)", "rust"]);
        test_case!("msvc/19/amd64", false, 
            actions: [PathAdd(r"C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\ClangC2\bin\amd64".to_owned()),
                ScriptExecute(r"C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\bin\amd64\vcvars64.bat".to_owned())]);
    }

    #[test]
    fn get_target_error() {

        if true { // File IO error
            let _ = match ConfigParser::from(".env_some_other") {
                Ok(_) => panic!("File open error not triggered"),
                Err(Error::FailOpenFile { e }) => assert_eq!(e.raw_os_error().unwrap(), 2), 
                Err(e) => panic!("Unexpected error throwed: {:?}", e),
            };
        }

        if true { // XML Reader Error
            let parser = ConfigParser::from(".env_xml_error").unwrap();

            let mut meet_expected_error = false;
            for event in parser {
                match event {
                    ConfigEvent::XMLReaderError { e: Error::FailParse { e } } => { 
                        meet_expected_error = true;
                        assert_eq!(format!("{}", e), "13:10 Unexpected token inside qualified name: />"); 
                        break; 
                    }
                    _ => (), 
                }
            }
            if !meet_expected_error {
                panic!("Didn't meet expected error");
            }
        } 

        if true { // Config parser errors

            macro_rules! test_case {
                ($file_name: expr, $expect_row: expr, $expect_col: expr, $expect_element: expr) => ({
                    let parser = ConfigParser::from($file_name).unwrap();

                    let mut meet_expected_error = false;
                    for event in parser {
                        match event {
                            ConfigEvent::XMLReaderError { e: Error::InvalidFormat { position, element } } => { 
                                meet_expected_error = true;
                                assert_eq!(position, TextPosition { row: $expect_row - 1, column: $expect_col - 1 });
                                assert_eq!(element, $expect_element);
                                break; 
                            }
                            _ => (), 
                        }
                    }
                    if !meet_expected_error {
                        panic!("Didn't meet expected error");
                    }
                })
            }

            test_case!(".env_to_invalid_in_paths", 24, 5, "paths");
            test_case!(".env_to_invalid_in_targets", 38, 5, "targets");
            test_case!(".env_to_invalid_in_target", 42, 7, "target");
        }

        if true { // Path to target errors 

            let file_name = ".env_for_get_target_error";

            if true { // Invalid path
                match get_target(file_name, "abc//asd", false) {
                    Err(Error::InvalidPath { path }) => assert_eq!(path, "abc//asd"),
                    Err(e) => panic!("Unexpect other error: {}", e),
                    Ok(_) => panic!("Unexpectedly succeed"),
                }
            }

            if true { // Target not set and no child
                match get_target(file_name, "rust/1.11/MSVC", false) {
                    Err(Error::TargetNotSet { path, path_node_pos, nodes_available }) => {
                        assert_eq!(path,  "rust/1.11/MSVC");
                        assert_eq!(path_node_pos, TextPosition { row: 51, column: 8 });
                        assert_eq!(nodes_available, Vec::<String>::new());
                    } 
                    Err(e) => panic!("Unexpect other error: {}", e),
                    Ok(_) => panic!("Unexpectedly succeed"),
                }

                match get_target(file_name, "rust", false) {
                    Err(Error::TargetNotSet { path, path_node_pos, nodes_available }) => {
                        assert_eq!(path,  "rust");
                        assert_eq!(path_node_pos, TextPosition { row: 53, column: 4 });
                        assert_eq!(nodes_available, vec!["stable", "1.11"]);
                    } 
                    Err(e) => panic!("Unexpect other error: {}", e),
                    Ok(_) => panic!("Unexpectedly succeed"),
                }
            }

            if true { // Target not exist
                match get_target(file_name, "py/2", false) {
                    Err(Error::TargetNotExist { path, target_name, target_config_pos }) => {
                        assert_eq!(path,  "py/2");
                        assert_eq!(target_name, "python-278-amd64");
                        assert_eq!(target_config_pos, TextPosition { row: 35, column: 6 });
                    } 
                    Err(e) => panic!("Unexpect other error: {}", e),
                    Ok(_) => panic!("Unexpectedly succeed"),
                }
            }

            if true { // Path node not found

                macro_rules! test_case {
                    ($full_path: expr, $correct: expr, $wrong: expr, $invalid: expr, $available: expr) => ({
                        match get_target(file_name, "python/450", false) {
                            Err(Error::PathNodeNotFound { path, correct_part, incorrect_node, is_invalid, nodes_available }) => {
                                assert_eq!(path, $full_path);
                                assert_eq!(correct_part, $correct);
                                assert_eq!(incorrect_node, $wrong);
                                assert_eq!(is_invalid, $invalid);
                                assert_eq!(nodes_available, $available);
                            }
                            Err(e) => panic!("Unexpected other error: {}", e),
                            Ok(_) => panic!("Unexpectedly succeed"),
                        }
                    })
                }

                test_case!("python/450", "python/", "450", false, vec!["3(3.4, 3.4.4)", "3.3(3.3.2)", "2(2.7, 2.7.8)", "x86", "amd64(x64)"]);
                test_case!("balabala", "(root)", "balabala", false, vec!["gcc(gnuc)", "git", "haskell(hs)", "java", "lua", "nasm", 
                    ".net(dotnet, netfx, netframework)", "vcpp(msvc)", "python(py)", "rust"]);
                test_case!("rust/1.11/MSVC/12345", "rust/1.11/MSVC/", "12345", true, Vec::<String>::new());
            }
        }
    }

    #[cfg(someverycomplex)]
    #[test]
    fn get_target_f() {
        
        let mut parser = ConfigParser::from(".env").unwrap();

        loop {
            match parser.next() {
                Some(event) => perrorln!("{:?}", event),
                None => break,
            }
        }

        parser = match parser.reset() {
            Ok(new_parser) => new_parser,
            Err(e) => { perrorln!("reset error: {:?}", e); return; }
        };
        
        loop {
            match parser.next() {
                Some(event) => perrorln!("{:?}", event),
                None => { perrorln!("Now breaked at second loop"); break; },
            }
        }

    }
}