
use anyhow::{anyhow, bail};
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

        let _print_count = self.base.read_u32()?;
        // ATTENTION no loop for now, because parsing operation is incomplete, second loop will meet invalid data
        let print = self.parse_print(&names)?.unwrap();

        Ok(BlueprintLibrary{ file_version, file_timestamp, prints: vec![print] })
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

    // the blue/green/redprint items in blueprint library or blueprint book
    fn parse_print(&mut self, names: &Names<'a>) -> anyhow::Result<Option<Print<'a>>> {
        let active = self.base.read_bool()?;
        if !active { return Ok(None); }

        let print_type = match self.base.read_u8()? {
            0 => "blueprint",
            1 => "blueprint-book",
            2 => "deconstruction-item",
            3 => "upgrade-item",
            v => bail!("0x{:x}: unknown print type {v}", self.base.position() - 1),
        };

        // what is generation?
        let _generation = self.base.read_u32()?;

        // this seems redundent data
        let print_item_index = self.base.read_u16()?;
        let alternative_print_type = names.get_item_name(print_item_index as usize)?;
        if print_type != alternative_print_type {
            bail!("0x{:x}: mismatch print item name '{}' != '{}'",
                self.base.position() - 2, print_type, alternative_print_type);
        }

        Ok(Some(match print_type {
            "blueprint" => Print::Blueprint(self.parse_blueprint(names)?),
            "blueprint-book" => Print::BlueprintBook(self.parse_blueprint_book(names)?),
            "deconstruction-item" => Print::DeconstructionPlan(self.parse_deconstruction_plan(names)?),
            "upgrade-item" => Print::UpgradePlan(self.parse_upgrade_plan(names)?),
            _ => unreachable!(),
        }))
    }

    fn parse_blueprint(&mut self, names: &Names<'a>) -> anyhow::Result<Blueprint<'a>> {

        let _label = self.base.read_str()?;
        self.base.expect(0)?; // mysterious skip

        let has_removed_mods = self.base.read_bool()?;
        if has_removed_mods {
            bail!("not support has removed mods for now");
        }
        let _content_size = self.base.read_length()?;
        let version = self.parse_version()?;

        self.base.expect(0)?; // mysterious skip
        self.parse_migrations()?;

        let description = self.base.read_str()?;
        let snap_to_grid = self.parse_snap_to_grid()?;

        let entity_count = self.base.read_u32()?;
        let mut entities = Vec::<BlueprintEntity<'a>>::new();
        for _ in 0..entity_count {
            let entity_name_index = self.base.read_u16()?;
            let entity_name = names.get_entity_name(entity_name_index as usize)?;

            // position is stored as u32 and use last byte to represent fraction part,
            // amazingly there is no precision error if convert f64, /256 is precise
        
            let maybe_offset_x = self.base.read_i16()? as i32;
            let position = if maybe_offset_x == 0x7FFF {
                (self.base.read_i32()? as f64 / 256.0, self.base.read_i32()? as f64 / 256.0)
            } else {
                let maybe_offset_y = self.base.read_i16()? as i32;
                if let Some((last_x, last_y)) = entities.last().map(|e| e.position) {
                    (last_x + maybe_offset_x as f64 / 256.0, last_y + maybe_offset_y as f64 / 256.0)
                } else {
                    (maybe_offset_x as f64 / 256.0, maybe_offset_y as f64 / 256.0)
                }
            };

            self.base.expect(0x20)?; // mysterious skip

            // this flag only have 0 or 0x10 value
            let has_entity_id = self.base.read_u8()? & 0x10 == 0x10;
            // this is not json format's entity_number, TODO check this value's postprocess
            let _entity_id = if has_entity_id {
                self.base.expect(1)?; // mysterious skip
                self.base.read_u32()?
            } else { 0 };

            let kind = match entity_name {
                "roboport" => EntityKind::Roboport(self.parse_roboport()?),
                _ => bail!("unhandled entity {entity_name}"),
            };

            entities.push(BlueprintEntity{ kind, position });
            // ATTENTION break first loop here because first loop is incomplete now and second loop will meet corrupted data
            break;
        }

        Ok(Blueprint{ version, description, snap_to_grid, entities })
    }
    fn parse_blueprint_book(&mut self, _names: &Names<'a>) -> anyhow::Result<BlueprintBook> {
        Ok(BlueprintBook{})
    }
    fn parse_deconstruction_plan(&mut self, _names: &Names<'a>) -> anyhow::Result<DeconstructionPlan> {
        Ok(DeconstructionPlan{})
    }
    fn parse_upgrade_plan(&mut self, _names: &Names<'a>) -> anyhow::Result<UpgradePlan> {
        Ok(UpgradePlan{})
    }

    fn parse_snap_to_grid(&mut self) -> anyhow::Result<Option<SnapToGrid>> {
        let snap_to_grid = self.base.read_bool()?;
        if !snap_to_grid {
            return Ok(None);
        }
        let x = self.base.read_u32()?;
        let y = self.base.read_u32()?;
        let absolute = self.base.read_bool()?;
        let (absolute_x, absolute_y) = if absolute {
            (self.base.read_u32()?, self.base.read_u32()?)
        } else { (0, 0) };

        Ok(Some(SnapToGrid{ size: (x, y), absolute: (absolute_x, absolute_y) }))
    }

    fn parse_roboport(&mut self) -> anyhow::Result<&'a str> {
        let has_circuit_connections = self.base.read_bool()?;

        Ok("")
    }
}

