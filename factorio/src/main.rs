// TODO wslpath "$(wslvar USERPROFILE)" to get windows userprofile to get blueprint-storage.dat
// inspired by/learn from https://github.com/asheiduk/factorio-blueprint-decoder/blob/master/decode
// but that's old and not for 2.0 and space age

use byteorder::{LittleEndian, ReadBytesExt};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read};

struct Reader<'a> {
    r: Cursor<&'a [u8]>,
}
impl<'a> Reader<'a> {
    fn new(buffer: &'a [u8]) -> Self {
        Self {
            r: Cursor::new(buffer),
        }
    }
}
impl<'a> Reader<'a> {
    fn position(&self) -> usize {
        self.r.position() as usize
    }
}
impl<'a> Reader<'a> {
    fn u8(&mut self) -> u8 {
        self.r.read_u8().expect("failed to read as u8")
    }
    fn i16(&mut self) -> i16 {
        self.r
            .read_i16::<LittleEndian>()
            .expect("failed to read as i16")
    }
    fn u16(&mut self) -> u16 {
        self.r
            .read_u16::<LittleEndian>()
            .expect("failed to read as u16")
    }
    fn i32(&mut self) -> i32 {
        self.r
            .read_i32::<LittleEndian>()
            .expect("failed to read as i32")
    }
    fn u32(&mut self) -> u32 {
        self.r
            .read_u32::<LittleEndian>()
            .expect("failed to read as u32")
    }

    fn length(&mut self) -> usize {
        let maybe_length = self.u8();
        if maybe_length == 0xFF {
            self.u32() as usize
        } else {
            maybe_length as usize
        }
    }
    fn str(&mut self) -> &'a str {
        let length = self.length();
        let position = self.position();
        self.r.set_position((position + length) as u64);
        std::str::from_utf8(&self.r.get_ref()[position..position + length]).expect("not a string")
    }
}
impl<'a> Reader<'a> {
    fn skip(&mut self, length: usize) {
        self.r.set_position(self.r.position() + (length as u64));
    }

    fn expect(&mut self, expect_bytes: &[u8]) {
        let base_position = self.position();
        for (i, expect) in expect_bytes.iter().enumerate() {
            // panic for now
            assert_eq!(
                self.u8(),
                *expect,
                "expect mismatch at position {}",
                base_position + i
            );
        }
    }
}

fn main() {
    let mut file = File::open("blueprint-storage.dat").expect("failed to open file");
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).expect("failed to read file");
    println!("file size {}", buffer.len());

    let mut r = Reader::new(&buffer);
    let version = (r.u16(), r.u16(), r.u16(), r.u16());
    println!("file version {version:?}");

    r.expect(&[0]);

    // this looks like for mod
    let migration_count = r.u8();
    println!("migration count {migration_count}");
    for _ in 0..migration_count {
        let _mod_name = r.str();
        let _migration_file = r.str();
        // println!("  mod name {mod_name} migration file {migration_file}");
    }

    // - global index, what is global index? design data structure when seen usage
    // - and why is this list does not contain any new item in space age?
    // - at least this is an id to name list, and seems have multiple namespace, at least item and recipe is not same namespace
    // because different namespace have same id value, I'd like to call that indexspace
    // - first collect all names together, display all names for same index
    // let mut index_to_all_names = HashMap::new(); // index => (prototype, name)
    // let index_and_all_names = index_to_all_names.into_iter().collect::<BinaryHeap<_>>().into_sorted_vec();
    // for (index, names) in &index_and_all_names {
    //     println!("{index} {names:?}");
    // }
    // - for now, item is item, recipe is recipe, virtual signal is virtual signal, tile is tile, other is entity
    let mut item_indexes = HashMap::new(); // index => name
    let mut recipe_indexes = HashMap::new(); // index => name
    let mut virtual_signal_indexes = HashMap::new(); // index => name
    let mut tile_indexes = HashMap::new(); // index => name
    let mut entity_indexes = HashMap::new(); // index => (name, prototype name)
    let prototype_count = r.u16();
    println!("global index prototype count {prototype_count}");
    for _ in 0..prototype_count {
        let prototype_name = r.str();
        let name_count = if prototype_name == "tile" { r.u8() as usize } else { r.u16() as usize };
        // println!("  prototype {} entries {}", prototype_name, name_count);
        for _ in 0..name_count {
            let index = if prototype_name == "tile" { r.u8() as usize } else { r.u16() as usize };
            let name = r.str();
            // println!("    name id {id}, name {name}");
            // index_to_all_names.entry(index).or_insert_with(|| Vec::new()).push((prototype_name, name));
            match prototype_name {
                | "capsule" // (capsule, raw fish) is item
                | "gun" // (gun, rocket launcher) is item? // NOTE rocket luancher is the gun, not rocket silo
                | "blueprint"
                | "item" => assert!(item_indexes.insert(index, name).is_none(), "duplicate index {prototype_name} {index} {name}"),
                "recipe" => assert!(recipe_indexes.insert(index, name).is_none(), "duplicate index {prototype_name} {index} {name}"),
                "virtual-signal" => assert!(virtual_signal_indexes.insert(index, name).is_none(), "duplicate index {prototype_name} {index} {name}"),
                "tile" => assert!(tile_indexes.insert(index, name).is_none(), "duplicate index {prototype_name} {index} {name}"),
                _ => assert!(entity_indexes.insert(index, (prototype_name, name)).is_none(), "duplicate index {prototype_name} {index} {name}"),
            }
        }
    }
    // println!("{item_indexes:?} {recipe_indexes:?} {entity_indexes:?} {virtual_signal_indexes:?}");

    r.skip(1);
    r.expect(&[0]);

    // generation counter, what's generation counter?
    let generation_counter = r.u32();
    println!("generation counter {generation_counter}");

    // this is 2023/11/12, what's this time? looks like the game install time?
    let timestamp = r.u32() as i64;
    let time = DateTime::<Utc>::from_timestamp(timestamp, 0).expect("invalid timestamp");
    println!("timestamp {}", time);

    r.expect(&[1]);

    // top level item is blueprint/book/redprint/greenprint, they are really item
    let top_level_item_count = r.u32();
    println!("top level item count {}", top_level_item_count);
    for slot_index in 0..top_level_item_count {
        let used = r.u8() != 0;
        if !used {
            println!("slot {slot_index} not used");
            continue;
        }

        let item_type = r.u8();
        let item_name = match item_type {
            0 => "blueprint",
            1 => "blueprint-book",
            2 => "deconstruction-item",
            3 => "upgrade-item",
            _ => panic!("top level item#{slot_index} unknown item type {item_type}"),
        };

        let _generation = r.u32();
    
        let item_index = r.u16() as usize;
        let alternative_item_name = item_indexes[&item_index];
        assert_eq!(item_name, alternative_item_name, "item name and alternative item name mismatch");

        if item_name == "blueprint" {
            let label = r.str(); // maybe empty
            r.expect(&[0]);
            let has_removed_mods = r.u8() != 0;
            if has_removed_mods {
                panic!("do not want to handle has removed mods for now");
            }
            let content_start_position = r.position();
            let content_size = r.length();
            let version = (r.u16(), r.u16(), r.u16(), r.u16());
            r.expect(&[0]);
            let migration_count = r.u8();
            for _ in 0..migration_count {
                let _mod_name = r.str();
                let _migration_file = r.str();
                // println!("  mod name {mod_name} migration file {migration_file}");
            }
            let description = r.str();
            println!("blueprint version {version:?} label {label} description {description}");

            let snap_to_grid = r.u8() != 0;
            if snap_to_grid {
                let snap_x = r.u32();
                let snap_y = r.u32();
                let absolute_snapping = r.u8() != 0;
                if absolute_snapping {
                    let relative_x = r.u32();
                    let relative_y = r.u32();
                    println!("  snap ({snap_x}, {snap_y}) absolute ({relative_x}, {relative_y})");
                } else {
                    println!("  snap ({snap_x}, {snap_y})");
                }
            }

            let entity_count = r.u32();
            let mut last_position: Option<(i32, i32)> = None; 
            for _ in 0..entity_count {
                let entity_index = r.u16() as usize;
                let Some((&ref entity_prototype_name, &ref entity_name)) = entity_indexes.get(&entity_index) else {
                    panic!("position {:x}, invalid entity index {entity_index}, entity indexes {entity_indexes:?}", r.position());
                };

                // position use last byte to represent fraction part,
                // for now related variables use the u32 part to avoid use float,
                // NOTE there is no precision error if convert f64, /256 is precise 
                let maybe_offset_x = r.i16() as i32;
                let position = if maybe_offset_x == 0x7FFF {
                    (r.i32(), r.i32())
                } else {
                    let maybe_offset_y = r.i16() as i32;
                    if let Some((last_x, last_y)) = last_position {
                        (last_x + maybe_offset_x, last_y + maybe_offset_y)
                    } else {
                        (maybe_offset_x, maybe_offset_y)
                    }
                };
                last_position = Some(position);
                println!("  entity {entity_name}({entity_prototype_name}) position ({}, {})", position.0 as f64 / 256.0, position.1 as f64 / 256.0);
                
                r.expect(&[0x20]);

                // this flag only have 0 or 0x10 value
                let has_entity_id = r.u8() & 0x10 == 0x10;
                // this is not json format's entity_number, TODO check this value's postprocess
                let entity_id = if has_entity_id {
                    r.expect(&[1]);
                    r.u32()
                } else { 0 };

                match entity_name {
                    "roboport" => {
                        r.expect(&[0]);
                        let has_circuit_connections = r.u8() != 0;
                        println!("    circuit connections {has_circuit_connections}");
                    },
                    "express-underground-belt" => {
                        let direction = r.u8();
                        let input_or_output = r.u8();
                    }
                    _ => todo!("{}", entity_name),
                }

                // entity contained items, like ammo
                let item_count = r.u32();
                for _ in 0..item_count {
                    let item_index = r.u16() as usize;
                    let item_name = item_indexes[&item_index];
                    let item_count = r.u32();
                    println!("    item {} count {}", item_name, item_count);
                }

                let has_tags = r.u8() != 0;
                if has_tags {
                    panic!("tags not handled");
                }

                // ATTENTION break first loop here because first loop is incomplete now and second loop will meet corrupted data
                // break;
            }
        }

        // ATTENTION break first loop here because first loop is incomplete now and second loop will meet corrupted data
        break;
    }
}
