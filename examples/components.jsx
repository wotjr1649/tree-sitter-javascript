// Small React-style components used by CI's "Parse examples" step.
import { Component, Fragment, useState } from "react";
import { Fade, icons } from "./ui.js";

export function Terms({ accepted, onAccept }) {
  return (
    <section class="terms" aria-label="Legal">
      <h2>Terms & Conditions</h2>
      <p>Read the Privacy &amp; Cookie policy, then continue &rarr; below.</p>
      <button disabled={accepted} onClick={() => onAccept(true)}>
        {accepted ? "Accepted" : "Accept"}
      </button>
    </section>
  );
}

export function TodoList({ items, filter = "all" }) {
  const [open, setOpen] = useState(true);
  const shown = items.filter((item) => filter === "all" || item.state === filter);

  return (
    <Fragment>
      <Fade in={open} timeout={{ enter: 200, exit: 100 }}>
        <ul className={open ? "list open" : "list"}>
          {shown.length === 0 && <li>Nothing to do & nothing done</li>}
          {shown.map((item) => (
            <li key={item.id} data-state={item.state}>
              <icons.delete size={12} /> {item.title}
              <icons.class />
            </li>
          ))}
        </ul>
      </Fade>
      <>
        <button onClick={() => setOpen(!open)}>Toggle</button>
        <a.delete href="#clear">Clear &amp; reset</a.delete>
      </>
    </Fragment>
  );
}

export class Toolbar extends Component {
  static defaultProps = { Icon: icons.class };

  render() {
    const { label } = this.props;
    return (
      <nav>
        <this.props.Icon title={label} />
        <this.props.icons.delete />
        {this.props.children ?? <em>Save & Exit</em>}
      </nav>
    );
  }
}
