import { crumbLabel, type B640Node } from '../routes';

/** Нейтральная страница узла, пока раздел не подключил свой экран. */
export function NodeStub({ node }: { readonly node: B640Node }) {
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <section className="b640-stub" aria-labelledby={`b640-stub-${node.code}`}>
        <h2 id={`b640-stub-${node.code}`}>{crumbLabel(node)}</h2>
      </section>
    </div>
  );
}
