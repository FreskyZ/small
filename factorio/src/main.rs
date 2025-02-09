// TODO wslpath "$(wslvar USERPROFILE)" to get windows userprofile to get blueprint-storage.dat
// inspired by/learn from https://github.com/asheiduk/factorio-blueprint-decoder/blob/master/decode
// but that's old and not for 2.0 and space age

use anyhow::Context;
use std::fs::File;
use std::io::Read;

mod binary_reader;
mod blueprint_library;
mod name;
mod parser;

fn main() -> anyhow::Result<()> {

    let mut buffer = Vec::new();
    let mut file = File::open("blueprint-storage.dat").with_context(|| "failed to open buluprint-storage.dat")?;
    file.read_to_end(&mut buffer).with_context(|| "failed to read blueprint-storage.dat")?;
    println!("file size {}", buffer.len());

    let mut parser = parser::Parser::new(binary_reader::Reader::new(&buffer));
    let library = parser.parse()?;

    println!("{library:?}");

    // // top level item is blueprint/book/redprint/greenprint, they are really item
    // let top_level_item_count = r.u32();
    // println!("top level item count {}", top_level_item_count);
    // for slot_index in 0..top_level_item_count {
    //     let used = r.u8() != 0;
    //     if !used {
    //         println!("slot {slot_index} not used");
    //         continue;
    //     }

    //     let item_type = r.u8();
    //     let item_name = match item_type {
    //         0 => "blueprint",
    //         1 => "blueprint-book",
    //         2 => "deconstruction-item",
    //         3 => "upgrade-item",
    //         _ => panic!("top level item#{slot_index} unknown item type {item_type}"),
    //     };

    //     let _generation = r.u32();
    
    //     let item_index = r.u16() as usize;
    //     let alternative_item_name = item_indexes[&item_index];
    //     assert_eq!(item_name, alternative_item_name, "item name and alternative item name mismatch");

    //     if item_name == "blueprint" {
    //         let label = r.str(); // maybe empty
    //         r.expect(&[0]);
    //         let has_removed_mods = r.u8() != 0;
    //         if has_removed_mods {
    //             panic!("do not want to handle has removed mods for now");
    //         }
    //         let content_start_position = r.position();
    //         let content_size = r.length();
    //         let version = (r.u16(), r.u16(), r.u16(), r.u16());
    //         r.expect(&[0]);
    //         let migration_count = r.u8();
    //         for _ in 0..migration_count {
    //             let _mod_name = r.str();
    //             let _migration_file = r.str();
    //             // println!("  mod name {mod_name} migration file {migration_file}");
    //         }
    //         let description = r.str();
    //         println!("blueprint version {version:?} label {label} description {description}");

    //         let snap_to_grid = r.u8() != 0;
    //         if snap_to_grid {
    //             let snap_x = r.u32();
    //             let snap_y = r.u32();
    //             let absolute_snapping = r.u8() != 0;
    //             if absolute_snapping {
    //                 let relative_x = r.u32();
    //                 let relative_y = r.u32();
    //                 println!("  snap ({snap_x}, {snap_y}) absolute ({relative_x}, {relative_y})");
    //             } else {
    //                 println!("  snap ({snap_x}, {snap_y})");
    //             }
    //         }

    //         let entity_count = r.u32();
    //         let mut last_position: Option<(i32, i32)> = None; 
    //         for _ in 0..entity_count {
    //             let entity_index = r.u16() as usize;
    //             let Some((&ref entity_prototype_name, &ref entity_name)) = entity_indexes.get(&entity_index) else {
    //                 panic!("position {:x}, invalid entity index {entity_index}, entity indexes {entity_indexes:?}", r.position());
    //             };

    //             // position use last byte to represent fraction part,
    //             // for now related variables use the u32 part to avoid use float,
    //             // NOTE there is no precision error if convert f64, /256 is precise 
    //             let maybe_offset_x = r.i16() as i32;
    //             let position = if maybe_offset_x == 0x7FFF {
    //                 (r.i32(), r.i32())
    //             } else {
    //                 let maybe_offset_y = r.i16() as i32;
    //                 if let Some((last_x, last_y)) = last_position {
    //                     (last_x + maybe_offset_x, last_y + maybe_offset_y)
    //                 } else {
    //                     (maybe_offset_x, maybe_offset_y)
    //                 }
    //             };
    //             last_position = Some(position);
    //             println!("  entity {entity_name}({entity_prototype_name}) position ({}, {})", position.0 as f64 / 256.0, position.1 as f64 / 256.0);
                
    //             r.expect(&[0x20]);

    //             // this flag only have 0 or 0x10 value
    //             let has_entity_id = r.u8() & 0x10 == 0x10;
    //             // this is not json format's entity_number, TODO check this value's postprocess
    //             let entity_id = if has_entity_id {
    //                 r.expect(&[1]);
    //                 r.u32()
    //             } else { 0 };

    //             match entity_name {
    //                 "roboport" => {
    //                     r.expect(&[0]);
    //                     let has_circuit_connections = r.u8() != 0;
    //                     println!("    circuit connections {has_circuit_connections}");
    //                 },
    //                 "express-underground-belt" => {
    //                     let direction = r.u8();
    //                     let input_or_output = r.u8();
    //                 }
    //                 _ => todo!("{}", entity_name),
    //             }

    //             // entity contained items, like ammo
    //             let item_count = r.u32();
    //             for _ in 0..item_count {
    //                 let item_index = r.u16() as usize;
    //                 let item_name = item_indexes[&item_index];
    //                 let item_count = r.u32();
    //                 println!("    item {} count {}", item_name, item_count);
    //             }

    //             let has_tags = r.u8() != 0;
    //             if has_tags {
    //                 panic!("tags not handled");
    //             }

    //             // ATTENTION break first loop here because first loop is incomplete now and second loop will meet corrupted data
    //             // break;
    //         }
    //     }

    //     // ATTENTION break first loop here because first loop is incomplete now and second loop will meet corrupted data
    //     break;
    // }

    Ok(())
}
