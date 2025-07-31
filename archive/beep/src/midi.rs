// after wave.rs
// after I have tried to encode note in a program I found that's actually the purpose of midi
// so this module investigate midi

// official site: https://www.midi.org/
// wiki: https://en.wikipedia.org/wiki/MIDI
// although official site have official specification document,
// this is still good: http://www.music.mcgill.ca/~ich/classes/mumt306/StandardMIDIfileformat.html
// a basic visualizer: https://cifkao.github.io/html-midi-player/
// free midi files sharing site: https://bitmidi.com/

use std::io::{Error, Read};

// midly don't give the function to read u28 from &[u8]
// return (result, byte length)
// for now, panic if invalid (more than 3 bytes have bit 7 set)
#[allow(dead_code)]
fn read_variable_length_quantity(raw: &[u8]) -> (midly::num::u28, usize) {
    if raw.len() > 0 && (raw[0] & 0x80) == 0 {
        (midly::num::u28::from_int_lossy(raw[0] as u32), 1)
    } else if raw.len() > 1 && (raw[0] & 0x80) == 1 && (raw[1] & 0x80) == 0 {
        // ATTENTION midi seems using big endian
        // ATTENTION only 7 bit of each byte is used
        (midly::num::u28::from_int_lossy(((raw[0] & 0x7F) as u32) << 7 + raw[1] as u32), 2)
    } else if raw.len() > 2 && (raw[0] & 0x80) == 1 && (raw[1] & 0x80) == 1 && (raw[2] & 0x80) == 0 {
        (midly::num::u28::from_int_lossy((((raw[0] & 0x7F) as u32) << 14) + (((raw[1] & 0x7F) as u32) << 7) + raw[2] as u32), 3)
    } else if raw.len() > 2 && (raw[0] & 0x80) == 1 && (raw[1] & 0x80) == 1 && (raw[2] & 0x80) == 1 && (raw[3] & 0x80) == 0 {
        (midly::num::u28::from_int_lossy((((raw[0] & 0x7F) as u32) << 14) + (((raw[1] & 0x7F) as u32) << 14) + (((raw[2] & 0x7F) as u32) << 7) + raw[3] as u32), 4)
    } else {
        panic!("invalid vairable length quantity");
    }
}

pub fn test() -> Result<(), Error> {

    // let mut file = std::fs::File::open("/mnt/c/Windows/Media/town.mid")?; // flourish, onestop, town
    let mut file = std::fs::File::open("/mnt/c/Users/localplaceholder/Downloads/Super Mario 64 - Medley.mid")?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let file = match midly::Smf::parse(&bytes) {
        Ok(file) => file,
        Err(error) => { eprintln!("{}", error); return Ok(()); }
    };

    match file.header.format {
        midly::Format::SingleTrack => println!("single track"),
        midly::Format::Parallel => println!("multiple track"),
        midly::Format::Sequential => println!("multiple songs of single track"),
    }
    match file.header.timing {
        midly::Timing::Metrical(value) => println!("{} ticks per beat", value),
        midly::Timing::Timecode(midly::Fps::Fps24, subframe) => println!("24 frames per second, {} subframes per frame", subframe),
        midly::Timing::Timecode(midly::Fps::Fps25, subframe) => println!("25 frames per second, {} subframes per frame", subframe),
        midly::Timing::Timecode(midly::Fps::Fps29, subframe) => println!("29.97 frames per second, {} subframes per frame", subframe),
        midly::Timing::Timecode(midly::Fps::Fps30, subframe) => println!("30 frames per second, {} subframes per frame", subframe),
    }
    println!("track count: {}", file.tracks.len());

    for (track_index, events) in file.tracks.iter().enumerate() {
        println!("track #{} ({} events)", track_index, events.len());
        for event in events {
            // if !matches!(event.kind, midly::TrackEventKind::Midi{..}) {
                print!("event ({}): ", event.delta);
            // }
            match event.kind {
                midly::TrackEventKind::SysEx(_) => println!("sysex event"),
                midly::TrackEventKind::Escape(_) => println!("continue sysex event"),
                midly::TrackEventKind::Meta(event) => {
                    use midly::MetaMessage::*;
                    print!("meta: ");
                    match event {
                        TrackNumber(Some(n)) => println!("sequence {}", n),
                        TrackNumber(None) => println!("sequence"),
                        // reference says this text should be ASCII, so string from utf8 should be ok
                        Text(bytes) => println!("text: {}", String::from_utf8_lossy(bytes)),
                        Copyright(bytes) => println!("copyright: {}", String::from_utf8_lossy(bytes)),
                        TrackName(bytes) => println!("track name: {}", String::from_utf8_lossy(bytes)),
                        InstrumentName(bytes) => println!("instrument name: {}", String::from_utf8_lossy(bytes)),
                        Lyric(bytes) => println!("lyric name: {}", String::from_utf8_lossy(bytes)),
                        Marker(bytes) => println!("marker name: {}", String::from_utf8_lossy(bytes)),
                        CuePoint(bytes) => println!("cue point name: {}", String::from_utf8_lossy(bytes)),
                        // not seen in the reference
                        ProgramName(bytes) => println!("program name: {}", String::from_utf8_lossy(bytes)),
                        // not seen in the reference
                        DeviceName(bytes) => println!("device name: {}", String::from_utf8_lossy(bytes)),
                        MidiChannel(channel) => println!("channel: {}", channel),
                        // not seen in the reference
                        MidiPort(count) => println!("port count: {}", count),
                        EndOfTrack => println!("EOT"),
                        Tempo(value) => println!("{}ms per quarter note", value),
                        SmpteOffset(offset) => println!("SMPTE offset {:?}", offset),
                        TimeSignature(numerator, denominator, v3, v4) => println!(
                            "time signature: {}/{}, {} clocks per quarter note, {} 32nd notes per quarter note", numerator, 1 << denominator, v3, v4),
                        KeySignature(offset, b) => println!("key signature: 1=C{}{}, {}",
                            if offset > 0 { "+" } else if offset < 0 { "-" } else { "" },
                            if offset != 0 { format!("{}", offset) } else { String::new() },
                            if b { "minor" } else { "major" }),
                        SequencerSpecific(_) => println!("other"),
                        Unknown(..) => println!("other unknown"),
                    }
                }
                midly::TrackEventKind::Midi { channel, message } => {
                    print!("channel #{}: ", channel);
                    println!("{:?}", message);
                },
            }
        }
    }

    Ok(())
}