
use config::target::Target;

pub struct PathNode {
    pub value: String,
    pub aliases: Vec<String>,
    pub children: Vec<PathNode>,
    pub target: Option<Target>,
}

impl PathNode {
    pub fn new() -> PathNode {
        PathNode {
            value: String::new(),
            aliases: Vec::new(), 
            children: Vec::new(), 
            target: None 
        }
    }

    pub fn from_config_element(xp: XMLElement) -> PathNode {
        // get_attribute for XMLAttribute, get_attribute_value for 'str
        let value = xp.get_attribute_value("value").unwrap();  // value must provide
        let aliases = match xp.get_attribute_value("alias") {
            Some(aliases) => {
                // Assume str.split(char) -> Vec<'str>, to_owned -> Vec<String>
                let mut alias_names = aliases.split('|').to_owned(); 
                alias_name.remove(value); // remove same with origin name
                alias_name
            },
            None => Vec::new(),
        }
        let target = match xp.get_attribute_value("target") => {
            Some(target) => target,
            None => None
        }
    }
}