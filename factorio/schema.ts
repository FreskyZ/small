// Factorio Blueprint Json Format Schema
// learned by reverse engineering json content

// TODO check blueprint book inside blueprint book

// not very package, but you need a name for the overall object
type Package =
    // single blueprint
    | { blueprint: Blueprint }
    // a blueprint book
    | { blueprint_book: BlueprintBook };

interface BlueprintBook {
    blueprints: IndexAnd<{ blueprint: Blueprint }>[],
    item: 'blueprint-book',
    label: string, // the item name
    description: string,
    icons: IndexAnd<{ signal: Signal }>[],
    active_index: number,
    version: Version,
}

// currently I assume this
type RealSignalName = EntityName;

interface RealSignal {
    name: RealSignalName,
}

type VirtualSignalName =
    | 'signal-S'
    | 'signal-heart'
    | 'signal-anything'
    | 'signal-each'

interface VirtualSignal {
    type: 'virtual',
    name: VirtualSignalName,
}

type Signal = VirtualSignal | RealSignal;

type IndexAnd<T> = T & {
    index: number,
}

// currently only seen this
// this is 2.0.1c.1, can see by f'{thisnumber:x}'
type Version = 562949955256321;

interface Blueprint {
    description?: string,
    'snap-to-grid'?: SnapToGrid,
    icons: IndexAnd<{ signal: Signal }>[],
    entities: Entity[], // TODO confirm this should be in scan order
    wires?: Wire[],
    tiles?: Tile[],
    item: 'blueprint',
    label: string, // the item name
    version: Version,
}

interface SnapToGrid {
    x: number,
    y: number,
    // I guess there is one more property for absolute/relative
}

// TODO learn the meaning
// currently I guess, (entity 1 index, connection type?, entity 2 index, connection type?)
// connection type currently seen 1/2/3/4/5, I guess copper/red/green wire and input/output side are combined here
// connection type 5 is seen on railway segment between far electric poles, both side is 5
type Wire = [number, number, number, number];

type TileName =
    | 'landfill';

interface Tile {
    position: Position,
    name: TileName,
}

type EntityName =
    | 'constant-combinator'
    | 'display-panel'
    | 'decider-combinator'
    | 'arithmetic-combinator'
    | 'selector-combinator'
    | 'small-lamp'
    | 'programmable-speaker'
    | 'steel-chest'
    | 'storage-chest'   // yellow chest
    | 'passive-provider-chest' // red chest
    | 'requester-chest' // blue chest
    | 'buffer-chest'    // green chest
    | 'bulk-inserter'
    | 'substation'
    | 'big-electric-pole' // this is the far electric pole, not the small steel electric pole
    | 'accumulator'
    | 'roboport'
    | 'train-stop'
    | 'rail-signal'
    | 'straight-rail'
    | 'curved-rail-a' // from the "smallest rail ring" blueprint, a 90deg turn is make up of two -a and two -b?
    | 'curved-rail-b'
    | 'half-diagonal-rail' // I guess this is new curved rail type in 2.0
    | 'rail-ramp'
    | 'rail-support'
    | 'elevated-straight-rail'
    | 'elevated-curved-rail-a'
    | 'elevated-curved-rail-b'
    | 'elevated-half-diagonal-rail'

interface Position {
    // TODO when will these values use .5,
    // looks like center position, 1x1 entity is always x:.5, y:.5
    // rail seems always 2 integers
    x: number,
    y: number,
}

// rgba values are 0 to 1
// lamb color, TODO train stop color, TODO train color?
interface Color {
    r: number,
    g: number,
    b: number,
    a: number,
}

// undefined/4/8/12 for normal 4 direction
// currenctly seen 2/6/10/14 for curved rail, so this should be a 30deg direction description
type Direction =
      | 4 | 8  | 12
    | 2 | 6 | 10  | 14;

// undefined for normal quality
type Quality =
    | 'uncommon'
    | 'rare'

interface Entity {
    entity_number: number,
    name: EntityName,
    position: Position,
    quality?: Quality,
    direction?: Direction,
    player_description?: string, // the additional description box that I normally not use
}

// ATTENTION https://lua-api.factorio.com/latest/defines.html#defines.control_behavior
// you can see some of the similiar definitions from this great grand glorious magnificant api document
// but they are not the same, lua api and blueprint import/export format is not the same thing

// I call this tv (television)
interface DisplayPanelEntity extends Entity {
    name: 'display-panel',
    icon: Signal,
    text: string, // TODO try calculate max length, TODO what happen when max length exceeds
}
interface ConstantCombinatorEntity extends Entity {
    name: 'constant-combinator',
    control_behavior: ConstantCombinatorControlBehavior,
}
interface ConstantCombinatorControlBehavior {
    // requestfilter's main property is also sections, why is this .sections.sections?
    sections: RequestFilters,
}
interface RequestFilters {
    sections: IndexAnd<RequestFilterSection>[],
    trash_not_requested?: true,
    request_from_buffers?: true, // allow green to blue
}
// this is one group of item filters in the game
interface RequestFilterSection {
    active?: false, // default to true, so value is only false
}
interface UnnamedRequestFilterSection extends RequestFilterSection {
    filters: RequestFilter[],
}
interface NamedRequestFilterSection extends RequestFilterSection {
    group: string,
}

type Comparator =
    | '='
    | '>'

type RequestFilter = IndexAnd<{}> & Signal & {
    // constant combinator always use '='
    comparator: Comparator,
    count: number,
    quality?: Quality,
}

// I call this gt (greater than) machine
interface DeciderCombinatorEntity extends Entity {
    name: 'decider-combinator',
    control_behavior: DeciderCombinatorControlBehavior
}
interface DeciderCombinatorControlBehavior {
    decider_conditions: DeciderCombinatorConditions,
}
interface DeciderCombinatorConditions {
    conditions: CircuitCondition[],
    outputs: CombinatorOutput[],
}
interface CircuitCondition {
    first_signal: Signal,
    first_signal_networks?: CircuitNetwork,
    // TODO when is this ommitted
    comparator?: Comparator,
    // TODO check or
    // TODO how to handle mixed and/or
    // seems required when and and not first condition
    compare_type?: 'and',
    constant?: number,
    // TODO when is second signal ommitted
    second_signal?: Signal,
    second_signal_networks?: CircuitNetwork,
}
interface CombinatorOutput {
    signal: Signal,
    copy_count_from_input?: false, // default to true if omitted
    networks?: CircuitNetwork,
}
// input from green/red, copy count from input green/red
interface CircuitNetwork {
    red: boolean,
    green: boolean,
}

// I call this add machine
interface ArithmeticCombinatorEntity extends Entity {
    name: 'arithmetic-combinator',
    control_behavior: ArithmeticCombinatorControlBehavior,
}
interface ArithmeticCombinatorControlBehavior {
    // this is called conditions, but include the output part
    arithmetic_conditions: ArithmeticCombinatorConditions,
}

type ArithemticOperation =
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'

// this is called conditions, but include the output part
interface ArithmeticCombinatorConditions {
    first_signal: Signal,
    second_signal?: Signal,
    second_constant?: number,
    operation: ArithemticOperation,
    output_signal: Signal,
    first_signal_networks?: CircuitNetwork,
    // TODO why is this specified when second signal is constant
    second_signal_networks?: CircuitNetwork,
}

interface SelectorCombinatorEntity extends Entity {
    name: 'selector-combinator',
    control_behavior: SelectorCombinatorControlBehavior,
}

type SelectorCombinatorOperation =
    | 'random'
    | 'select'
interface SelectorCombinatorControlBehavior {
    operation: SelectorCombinatorOperation,
}
interface SelectorCombinatorRandomControlBehavior extends SelectorCombinatorControlBehavior {
    operation: 'random',
    random_update_interval: number,
}
interface SelectorCombinatorSelectControlBehavior extends SelectorCombinatorControlBehavior {
    operation: 'select',
    // TODO what's this
    select_max?: true,
    index_signal: Signal,
}

interface TrainStopEntity extends Entity {
    name: 'train-stop',
    station: string, // the station name
    control_behavior: TrainStopControlBehavior,
}
interface TrainStopControlBehavior {
    send_to_train: boolean,
    read_from_train: boolean,
    read_stopped_train: boolean,
    train_stopped_signal: Signal,
    set_trains_limit: boolean,
    trains_limit_signal: Signal,
}

interface LampEntity extends Entity {
    name: 'small-lamp',
    color: Color,
    control_behavior: LampControlBehavior,
    always_on?: true,
}
// TODO some of the properties seems cannot exist at the same time
interface LampControlBehavior {
    circuit_enabled?: true,
    circuit_condition?: CircuitCondition,
    use_colors?: true,
    // TODO used values
    color_mode?: number,
}

interface ProgrammableSpeakerEntity extends Entity {
    name: 'programmable-speaker',
    control_behavior: ProgrammableSpeakerControlBehavior,
    parameters: ProgrammableSpeakerParameters,
    alert_parameters: ProgrammableSpeakerAlertParameters,
}
interface ProgrammableSpeakerControlBehavior {
    circuit_condition: CircuitCondition,
    circuit_parameters: ProgrammableSpeakerCircuitParameters,
}
interface ProgrammableSpeakerCircuitParameters {
    signal_value_is_pitch: false,
    instrument_id: number,
    note_id: number,
}

// TODO other values
type ProgrammableSpeakerPlaybackMode = 
    | 'surface'

interface ProgrammableSpeakerParameters {
    playback_volumn: number, // looks like 0-1
    playback_mode: ProgrammableSpeakerPlaybackMode,
    allow_polyphony: boolean,
}
interface ProgrammableSpeakerAlertParameters {
    show_alert: boolean,
    show_on_map: boolean,
    icon_signal_id: Signal,
    alert_message: string,
}

interface RequesterChestEntity extends Entity {
    name: 'requester-chest',
    control_behavior: LogisticChestControlBehavior,
}
interface BufferChestEntity extends Entity {
    name: 'buffer-chest',
    control_behavior: LogisticChestControlBehavior,
    // TODO there is default empty filter in green chest and blue chest, can cleanup/normalize remove them if not needed
    request_filters: RequestFilters,
}
interface LogisticChestControlBehavior {
    // TODO confirm 1: set request, 2: read content
    circuit_mode_of_operation: 1 | 2,
    circuit_condition_enabled?: true,
    circuit_condition: CircuitCondition,
}

interface InserterEntity extends Entity {
    name: 'bulk-inserter',
    control_behavior: InserterControlBehavior,
    use_filters: boolean, // why is this not in control_behaviors
}
interface InserterControlBehavior {
    circuit_enabled?: true,
    circuit_condition: CircuitCondition,
    circuit_set_filters?: true,
    // TODO the signal is default to S, check what happen when signal is not S
    circuit_set_stack_size?: true,
}

interface RoboportEntity extends Entity {
    name: 'roboport',
    control_behavior: RoboportControlBehavior,
    request_filters: RequestFilters,
}
interface RoboportControlBehavior {
    red_robot_stats: true,
    // TODO confirm these are Signal shape
    available_logistic_output_signal: Signal | null,
    available_construction_output_signal: Signal | null,
    roboport_count_output_signal: Signal | null,
}
