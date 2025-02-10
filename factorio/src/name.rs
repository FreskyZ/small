
// global index to name map
// TODO can the names under prototype (https://wiki.factorio.com/Data.raw) be called "name"s?
// TODO when talking about blueprint library file format, is it proper to call this name collection "names"?
// but for now, the different bucket for indexes are called namespace

use anyhow::bail;
use std::fmt;

// the strings are still borrowing the buffer
pub struct Names<'a> {
    // 6 namespaces, see later
    // there are less than 300 items in each namespace,
    // use sparse array seems good, not used entries use static empty string
    names: [Vec<&'a str>; 6],
}

#[allow(dead_code)]
impl<'a> Names<'a> {

    pub fn new() -> Self {
        Self{ names: Default::default() }
    }

    // prototype name is used to determine namespace // TODO is this correct?
    // for now prototype name is not stored
    pub fn add(&mut self, index: usize, name: &'a str, prototype_name: &'a str) -> anyhow::Result<()> {
        let namespace_index = match prototype_name {
            | "capsule" // (capsule, raw fish) is item
            | "gun" // (gun, rocket launcher) is item? // NOTE rocket luancher is the gun, not rocket silo
            | "blueprint"
            | "item" => 0,
            "recipe" => 1,
            "virtual-signal" => 4,
            "tile" => 3,
            // for now all other things are entity
            _ => 2,
        };
        if self.names[namespace_index].len() < index + 1 {
            self.names[namespace_index].resize(index + 1, "");
        }
        if self.names[namespace_index][index] != "" {
            bail!("namespace {} duplicate index {} name {} prototype name {}", namespace_index, index, name, prototype_name);
        }
        self.names[namespace_index][index] = name;
        Ok(())
    }

    // NOTE self.names stored in this order

    pub fn get_item_name(&self, index: usize) -> anyhow::Result<&'a str> {
        if self.names[0].len() <= index { bail!("name index out of range"); }
        if self.names[0][index] == "" { bail!("name index invalid"); }
        Ok(self.names[0][index])
    }
    pub fn get_recipe_name(&self, index: usize) -> anyhow::Result<&'a str> {
        if self.names[1].len() <= index { bail!("name index out of range"); }
        if self.names[1][index] == "" { bail!("name index invalid"); }
        Ok(self.names[1][index])
    }
    pub fn get_entity_name(&self, index: usize) -> anyhow::Result<&'a str> {
        if self.names[2].len() <= index { bail!("name index out of range"); }
        if self.names[2][index] == "" { bail!("name index invalid"); }
        Ok(self.names[2][index])
    }
    pub fn get_tile_name(&self, index: usize) -> anyhow::Result<&'a str> {
        if self.names[3].len() <= index { bail!("name index out of range"); }
        if self.names[3][index] == "" { bail!("name index invalid"); }
        Ok(self.names[3][index])
    }
    pub fn get_virtual_signal_name(&self, index: usize) -> anyhow::Result<&'a str> {
        if self.names[4].len() <= index { bail!("name index out of range"); }
        if self.names[4][index] == "" { bail!("name index invalid"); }
        Ok(self.names[4][index])
    }
    pub fn get_fluid_name(&self, index: usize) -> anyhow::Result<&'a str> {
        if self.names[5].len() <= index { bail!("name index out of range"); }
        if self.names[5][index] == "" { bail!("name index invalid"); }
        Ok(self.names[5][index])
    }
}

impl<'a> fmt::Debug for Names<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "items:")?;
        for (index, name) in self.names[0].iter().enumerate().filter(|(_, v)| !v.is_empty()) {
            writeln!(f, "  {index}: {}", *name)?;
        }
        writeln!(f, "recipes:")?;
        for (index, name) in self.names[1].iter().enumerate().filter(|(_, v)| !v.is_empty()) {
            writeln!(f, "  {index}: {}", *name)?;
        }
        writeln!(f, "entities:")?;
        for (index, name) in self.names[2].iter().enumerate().filter(|(_, v)| !v.is_empty()) {
            writeln!(f, "  {index}: {}", *name)?;
        }
        writeln!(f, "tiles:")?;
        for (index, name) in self.names[3].iter().enumerate().filter(|(_, v)| !v.is_empty()) {
            writeln!(f, "  {index}: {}", *name)?;
        }
        writeln!(f, "virtual signals:")?;
        for (index, name) in self.names[4].iter().enumerate().filter(|(_, v)| !v.is_empty()) {
            writeln!(f, "  {index}: {}", *name)?;
        }
        writeln!(f, "fluids:")?;
        for (index, name) in self.names[5].iter().enumerate().filter(|(_, v)| !v.is_empty()) {
            writeln!(f, "  {index}: {}", *name)?;
        }
        Ok(())
    }
}
