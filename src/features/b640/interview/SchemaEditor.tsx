import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../kit';
import {
  addBlock,
  moveBlock,
  removeBlock,
  renameBlock,
  type SchemaBlock,
  type SchemaEdit,
} from './model/practiceModel';

const NEW_BLOCK = 'Новый блок';
const MAP_LABEL = 'Схема по вашему ответу, блоки по порядку';

function NameField(props: {
  readonly id: string;
  readonly label: string;
  readonly onDone: (label: string | null) => void;
}) {
  const [value, setValue] = useState(props.label);
  const input = useRef<HTMLInputElement>(null);
  // Поле появляется по нажатию «Переименовать» или «Добавить блок»: ввод сразу в нём.
  useEffect(() => input.current?.focus(), []);
  const commit = () =>
    props.onDone(value.trim() && value.trim() !== props.label ? value.trim() : null);
  return (
    <input
      className="sd-name"
      id={props.id}
      ref={input}
      aria-label="Название блока"
      value={value}
      maxLength={80}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') props.onDone(null);
      }}
    />
  );
}

function NodeActions(props: {
  readonly id: string;
  readonly nameId: string;
  readonly first: boolean;
  readonly last: boolean;
  readonly onEdit: (edit: SchemaEdit) => void;
}) {
  return (
    <>
      <button
        className="icon-btn"
        type="button"
        aria-label="Выше"
        aria-describedby={props.nameId}
        disabled={props.first}
        onClick={() => props.onEdit(moveBlock(props.id, -1))}
      >
        <Icon name="down" className="k-up" />
      </button>
      <button
        className="icon-btn"
        type="button"
        aria-label="Ниже"
        aria-describedby={props.nameId}
        disabled={props.last}
        onClick={() => props.onEdit(moveBlock(props.id, 1))}
      >
        <Icon name="down" />
      </button>
      <button
        className="icon-btn"
        type="button"
        aria-label="Убрать"
        aria-describedby={props.nameId}
        onClick={() => props.onEdit(removeBlock(props.id))}
      >
        <Icon name="close" />
      </button>
    </>
  );
}

function Node(props: {
  readonly block: SchemaBlock;
  readonly index: number;
  readonly last: boolean;
  readonly editing: boolean;
  readonly onEdit: (edit: SchemaEdit | null) => void;
  readonly onRename: () => void;
}) {
  const { block, index } = props;
  const nameId = `sd-n${index}`;
  return (
    <li className="sd-node">
      {props.editing ? (
        <NameField
          id={nameId}
          label={block.label}
          onDone={(label) => props.onEdit(label ? renameBlock(block.id, label) : null)}
        />
      ) : (
        <button
          className="sd-name"
          type="button"
          id={nameId}
          title="Переименовать"
          onClick={props.onRename}
        >
          {block.label}
        </button>
      )}
      <NodeActions
        id={block.id}
        nameId={nameId}
        first={index === 0}
        last={props.last}
        onEdit={props.onEdit}
      />
    </li>
  );
}

/** I3b: схема по ответу — кандидат переименовывает, переставляет, убирает и добавляет блоки. */
export function SchemaEditor(props: {
  readonly blocks: readonly SchemaBlock[];
  readonly onEdit: (edit: SchemaEdit) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const apply = (edit: SchemaEdit | null) => {
    setEditing(null);
    if (edit) props.onEdit(edit);
  };
  const add = () => {
    const edit = addBlock(NEW_BLOCK);
    props.onEdit(edit);
    setEditing(edit.id);
  };
  return (
    <>
      <h3 className="mod-title">Схема по вашему ответу</h3>
      {props.blocks.length > 0 ? (
        <ol className="sd-map is-edit" aria-label={MAP_LABEL}>
          {props.blocks.map((block, index) => (
            <Node
              key={block.id}
              block={block}
              index={index}
              last={index === props.blocks.length - 1}
              editing={editing === block.id}
              onEdit={apply}
              onRename={() => setEditing(block.id)}
            />
          ))}
        </ol>
      ) : (
        <p className="row-sub">Блоки появятся, когда вы назовёте части системы.</p>
      )}
      <div className="actions">
        <Button variant="quiet" onClick={add}>
          <Icon name="plus" />
          Добавить блок
        </Button>
      </div>
    </>
  );
}

/** I3c: та же схема без правок. */
export function SchemaView({ blocks }: { readonly blocks: readonly SchemaBlock[] }) {
  return (
    <ol className="sd-map" aria-label={MAP_LABEL}>
      {blocks.map((block) => (
        <li className="sd-node" key={block.id}>
          <span className="sd-name">{block.label}</span>
        </li>
      ))}
    </ol>
  );
}
