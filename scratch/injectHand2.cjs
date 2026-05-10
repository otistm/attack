const fs = require('fs');
let code = fs.readFileSync('src/components/CardGameOverlay.tsx', 'utf-8');

if (!code.includes('<ManagerHand side={userSide} />')) {
  // Replace the closing fragment inside CardGameOverlay component.
  // We'll just search for the end of CardGameOverlay.
  // It looks like:
  //         </div>
  //       </div>
  //     </>
  //   );
  // };
  
  // We can just find `export const CardGameOverlay = () => {`
  // and trace its braces, or use a simpler replace
  code = code.replace(
    /        <\/div>\r?\n      <\/div>\r?\n    <\/>\r?\n  \);\r?\n};/g,
    "        </div>\n      </div>\n      <ManagerHand side={userSide} />\n    </>\n  );\n};"
  );
  
  fs.writeFileSync('src/components/CardGameOverlay.tsx', code);
  console.log("Injected ManagerHand correctly");
} else {
  console.log("Already injected ManagerHand");
}
