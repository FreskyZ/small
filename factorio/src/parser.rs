
use std::marker::PhantomData;
use anyhow::anyhow;
use chrono::{DateTime, Utc};

use crate::binary_reader::Reader;
use crate::blueprint_library::*;
use crate::name::Names;

pub struct Parser<'a> {
    base: Reader<'a>,
}
impl<'a> Parser<'a> {
    pub fn new(base: Reader<'a>) -> Self {
        Self{ base }
    }

    pub fn parse(&mut self) -> anyhow::Result<BlueprintLibrary<'a>> {

        let file_version = self.parse_version()?;

        self.base.expect(0)?; // mysterious skip
        self.parse_migrations()?;

        let names = self.parse_global_names()?;
        // println!("{:?}", names);

        self.base.skip(1)?; // mysterious skip
        self.base.expect(0)?; // mysterious skip
        // what's generation counter?
        let _generation_counter = self.base.read_u32()?;

        // this is 2023/11/12, what's this time? looks like the game install time?
        let timestamp = self.base.read_u32()? as i64;
        let file_timestamp = DateTime::<Utc>::from_timestamp(timestamp, 0).ok_or_else(|| anyhow!("invalid timestamp"))?;

        self.base.expect(1)?; // mysterious skip

        Ok(BlueprintLibrary{ file_version, file_timestamp, phantom: PhantomData })
    }

    fn parse_version(&mut self) -> anyhow::Result<Version> {
        Ok((self.base.read_u16()?, self.base.read_u16()?, self.base.read_u16()?, self.base.read_u16()?))
    }

    // migrations seems are for mod
    // https://lua-api.factorio.com/latest/auxiliary/migrations.html
    // not related to me currently so ignore result
    fn parse_migrations(&mut self) -> anyhow::Result<()> {
        let migration_count = self.base.read_u8()?;
        for _ in 0..migration_count {
            let _mod_name = self.base.read_str()?;
            let _migration_file = self.base.read_str()?;
        }
        Ok(())
    }

    fn parse_global_names(&mut self) -> anyhow::Result<Names<'a>> {
        let mut names = Names::new();

        // TODO this is definitely 1.0 content,
        // it does not have any 2.0 and spaceage name, and have 1.0 specific name like RCU?
        let prototype_count = self.base.read_u16()?;
        for _ in 0..prototype_count {
            let prototype_name = self.base.read_str()?;
            let name_count = self.base.read_u16_unless_then_u8(prototype_name == "tile")?;
            for _ in 0..name_count {
                let index = self.base.read_u16_unless_then_u8(prototype_name == "tile")?;
                let name = self.base.read_str()?;
                names.add(index, name, prototype_name)?;
            }
        }
        Ok(names)
    }
}

