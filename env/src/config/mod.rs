
mod result;
mod parser;

use xml::common::TextPosition;

use config::parser::{ PathNode, ConfigEvent, ConfigParser };
pub use config::result::{ TargetAction, ConfigResult };
pub use config::result::MergedVarAdd;
pub use config::result::MergedResult;
pub use error::Error;

#[derive(Debug)]
enum State<'a> {
    WaitingPaths,
    SearchingPathNode {
        expect_depth: usize,    
        expect_value: &'a str,
        correct_part: String,
        last_depth_has_target: bool,
        current_depth_availables: Vec<String>,
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
                    State::SearchingPathNode::<'a> { 
                        expect_depth: 0, expect_value: split_path[0], 
                        current_depth_availables: Vec::new(), correct_part: String::new(), last_depth_has_target: false }
                } else {
                    State::RecordingAvailables { expect_depth: 0, ret_val: Vec::new() }
                }
            },
            _ => self
        }
    }

    fn start_p(self, inner: PathNode, split_path: &'a Vec<&str>, require_list: bool, parser_position: TextPosition) -> Self {
         match self {
            State::SearchingPathNode { expect_depth, expect_value, mut current_depth_availables, correct_part, last_depth_has_target } => {
                if inner.depth == expect_depth && inner.has(expect_value) {
                    // Find a match
                    if split_path.len() > inner.depth + 1 {
                        return State::SearchingPathNode { 
                            expect_depth: expect_depth + 1, 
                            expect_value: split_path[inner.depth + 1], 
                            current_depth_availables: Vec::new(),
                            correct_part: correct_part + expect_value + "/",
                            last_depth_has_target: inner.target.is_some(),
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
                } else {
                    // Not match
                    if inner.depth == expect_depth {
                        current_depth_availables.push(inner.to_string());
                    }
                    State::SearchingPathNode { 
                        expect_depth: expect_depth, 
                        expect_value: expect_value, 
                        current_depth_availables: current_depth_availables,
                        correct_part: correct_part,
                        last_depth_has_target: last_depth_has_target,
                    }
                }
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
            State::SearchingPathNode { expect_depth, expect_value, current_depth_availables, correct_part, last_depth_has_target } => {
                if depth + 1 == expect_depth { // Not found
                    return MaybeReturn::Return(Err(Error::PathNodeNotFound { 
                        path: full_path.to_owned(), 
                        correct_part: if correct_part.is_empty() { "(root)".to_owned() } else { correct_part }, 
                        incorrect_node: expect_value.to_owned(), 
                        is_invalid: !last_depth_has_target && current_depth_availables.is_empty(), 
                        nodes_available: current_depth_availables,
                    }));
                }
                MaybeReturn::State(State::SearchingPathNode {
                    expect_depth: expect_depth, 
                    expect_value: expect_value, 
                    current_depth_availables: current_depth_availables,
                    correct_part: correct_part,
                    last_depth_has_target: last_depth_has_target,
                })   
            }
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
            State::SearchingPathNode { expect_depth: _1, expect_value, current_depth_availables, correct_part, last_depth_has_target } => {
                return MaybeReturn::Return(Err(Error::PathNodeNotFound { 
                    path: full_path.to_owned(), 
                    correct_part: if correct_part.is_empty() { "(root)".to_owned() } else { correct_part }, 
                    incorrect_node: expect_value.to_owned(), 
                    is_invalid: !last_depth_has_target && current_depth_availables.is_empty(), 
                    nodes_available: current_depth_availables,
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

// const INDENT: [&'static str; 7] 
//     = ["", "   ", "      ", "         ", "            ", "               ", "                    "];
fn get_target(parser: &mut ConfigParser, full_path: &str, require_list: bool) -> Result<ConfigResult, Error> {

    let split_path = try!(split_path(full_path));
    let mut state = State::WaitingPaths;

    loop {
        match parser.next() {
            // Path
            Some(ConfigEvent::StartPaths) => {
                // perrorln!("StartPaths");
                state = state.start_paths(&split_path);
            },
            Some(ConfigEvent::StartP { inner }) => {
                // perrorln!("{:?}\n{}state {:?}\n", inner, INDENT[inner.depth], state);
                state = state.start_p(inner, &split_path, require_list, parser.stream_pos());
            },
            Some(ConfigEvent::EndP { depth }) => {
                // perrorln!("{}EndP\n{}state: {:?}\n", INDENT[depth], INDENT[depth], state);
                match state.end_p(depth, full_path, parser.stream_pos()) {
                    MaybeReturn::State(new_state) => { state = new_state; }
                    MaybeReturn::Return(ret_val) => { return ret_val; }
                }
            },
            Some(ConfigEvent::EndPaths) => {
                // perrorln!("EndPaths");
                match state.end_paths(full_path, parser.stream_pos()) {
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
            None => return Err(Error::UnexpectedInternalError_ReachUnexpectedInternalState), // If all correct, will not goto end document
        }
    }
}

pub struct Config {
    file_name: String, 
}

impl Config {
    pub fn new(file_name: String) -> Config {
        Config { file_name: file_name, }
    }

    pub fn input(&self, full_path: &str, require_list: bool) -> Result<ConfigResult, Error> {
        let mut parser = try!(ConfigParser::from(&*self.file_name));
        get_target(&mut parser, full_path, require_list)
    }

    // batch process input and combine results, they should be same subtype of ConfigResult
    // combine target actions, combine to map<var, [value]>
    pub fn batch(&self, paths: Vec<String>) -> (MergedResult, Vec<Error>) {
        let mut results = Vec::new();
        let mut errors = Vec::new();    

        for path in paths {
            match self.input(&*path, false) {
                Ok(result) => results.push(result),
                Err(error) => errors.push(error),
            }
        }

        match ConfigResult::merge(results) {
            Ok(result) => (result, errors),
            Err(e) => {
                errors.push(e);
                (MergedResult::new(), errors)
            }
        }
    }
}

#[cfg(test)]
mod tests {

    use super::Config;
    use super::ConfigResult;
    use super::TargetAction::*;
    use super::parser::{ ConfigEvent, ConfigParser };
    use error::Error;
    use xml::common::{ TextPosition };

    #[test]
    fn get_targets() {
        
        macro_rules! test_case {
            ($config: expr, $full_path: expr, $req: expr, actions: [$($actions:tt)*]) => ({
                match $config.input($full_path, $req) {
                    Ok(ConfigResult::Actions(actions)) => {
                        assert_eq!(actions, vec![$($actions)*]);
                    }
                    Ok(_) => unreachable!(),
                    Err(e) => panic!("{:?}", e),
                }
            });
            
            ($config: expr, $full_path: expr, $req: expr, nexts: [$($nexts:tt)*]) => ({
                match $config.input($full_path, $req) {
                    Ok(ConfigResult::AvailablePathNodes(nexts)) => {
                        assert_eq!(nexts, vec![$($nexts)*]);
                    }
                    Ok(_) => unreachable!(),
                    Err(e) => panic!("{:?}", e),
                }
            })
        }

        let config = Config::new("tests/.env".to_owned());

        test_case!(config, "msvc/19", true,
            nexts: ["m32(x86)", "m64(amd64, x64)"]);
        test_case!(config, "", true,
            nexts: ["gcc(gnuc)", "git", "haskell(hs)", "java", "lua", "nasm", 
                ".net(dotnet, netfx, netframework)", "vcpp(msvc)", "python(py)", "rust"]);
        test_case!(config, "msvc/19/amd64", false, 
            actions: [PathAdd(r"C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\ClangC2\bin\amd64".to_owned()),
                ScriptExecute(r"C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\bin\amd64\vcvars64.bat".to_owned())]);
    }

    #[test]
    fn get_target_error() {
        // For copy/paste: false true
        
        if true { // File IO error
            let _ = match ConfigParser::from("tests/.env_some_other") {
                Ok(_) => panic!("File open error not triggered"),
                Err(Error::FailOpenFile { file_name: _1, e }) => assert_eq!(e.raw_os_error().unwrap(), 2), 
                Err(e) => panic!("Unexpected error throwed: {:?}", e),
            };
        }

        if true { // XML Reader Error
            let parser = ConfigParser::from("tests/.env_xml_error").unwrap();

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

            test_case!("tests/.env_to_invalid_in_paths", 24, 5, "paths");
            test_case!("tests/.env_to_invalid_in_targets", 38, 5, "targets");
            test_case!("tests/.env_to_invalid_in_target", 42, 7, "target");
        }

        if true { // Path to target errors 

            let file_name = "tests/.env_for_get_target_error";
            let config = Config::new(file_name.to_owned());

            if true { // Invalid path
                match config.input("abc//asd", false) {
                    Err(Error::InvalidPath { path }) => assert_eq!(path, "abc//asd"),
                    Err(e) => panic!("Unexpect other error: {}", e),
                    Ok(_) => panic!("Unexpectedly succeed"),
                }
            }

            if true { // Target not set and no child
                match config.input("rust/1.11/MSVC", false) {
                    Err(Error::TargetNotSet { path, path_node_pos, nodes_available }) => {
                        assert_eq!(path,  "rust/1.11/MSVC");
                        assert_eq!(path_node_pos, TextPosition { row: 51, column: 8 });
                        assert_eq!(nodes_available, Vec::<String>::new());
                    } 
                    Err(e) => panic!("Unexpect other error: {}", e),
                    Ok(_) => panic!("Unexpectedly succeed"),
                }

                match config.input("rust", false) {
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
                match config.input("py/2", false) {
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
                    ($config: expr, $full_path: expr, $correct: expr, $wrong: expr, $invalid: expr, $available: expr) => ({
                        match $config.input($full_path, false) {
                            Err(Error::PathNodeNotFound { path, correct_part, incorrect_node, is_invalid, nodes_available }) => {
                                assert_eq!(path, $full_path);
                                assert_eq!(correct_part, $correct);
                                assert_eq!(incorrect_node, $wrong);
                                assert_eq!(is_invalid, $invalid);
                                assert_eq!(nodes_available, $available);
                                // perrorln!("Meet expected error: {}", Error::PathNodeNotFound { 
                                //     path: path, 
                                //     correct_part: correct_part, 
                                //     incorrect_node: incorrect_node, 
                                //     is_invalid: is_invalid, 
                                //     nodes_available: nodes_available });
                            }
                            Err(e) => panic!("Unexpected other error: {}", e),
                            Ok(_) => panic!("Unexpectedly succeed"),
                        }
                    })
                }

                test_case!(config, "python/450", "python/", "450", false, vec!["3(3.4, 3.4.4)", "3.3(3.3.2)", "2(2.7, 2.7.8)", "x86", "amd64(x64)"]);
                test_case!(config, "balabala", "(root)", "balabala", false, vec!["gcc(gnuc)", "git", "haskell(hs)", "java", "lua", "nasm", 
                     ".net(dotnet, netfx, netframework)", "vcpp(msvc)", "python(py)", "rust"]);
                test_case!(config, "rust/1.11/MSVC/12345", "rust/1.11/MSVC/", "12345", true, Vec::<String>::new());
            }
        }
    }

    #[cfg(someverycomplex)]
    #[test]
    fn get_target_f() {
        
        let mut parser = ConfigParser::from("tests/.env").unwrap();

        loop {
            match parser.next() {
                Some(event) => perrorln!("{:?}", event),
                None => break,
            }
        }

        // parser = match parser.reset() {
        //     Ok(new_parser) => new_parser,
        //     Err(e) => { perrorln!("reset error: {:?}", e); return; }
        // };
        
        loop {
            match parser.next() {
                Some(event) => perrorln!("{:?}", event),
                None => { perrorln!("Now breaked at second loop"); break; },
            }
        }

    }
}