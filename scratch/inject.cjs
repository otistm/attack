const fs = require('fs');
let code = fs.readFileSync('src/components/CardGameOverlay.tsx', 'utf-8');

if (!code.includes('ManagerHand')) {
  code = code.replace(
    /import \{ PlayerHero \} from '\.\/PlayerHero';/g,
    "import { PlayerHero } from './PlayerHero';\nimport { ManagerHand } from './ManagerHand';"
  );
  
  // Find the end of export const CardGameOverlay return statement and insert the ManagerHand.
  // The structure is roughly:
  // return (
  //   <div ...>
  //      ...
  //   </div>
  // );
  // };
  
  code = code.replace(
    /  \);\n};\n/g,
    "    <ManagerHand side={userSide} />\n  );\n};\n"
  );
  
  fs.writeFileSync('src/components/CardGameOverlay.tsx', code);
  console.log('ManagerHand injected');
} else {
  console.log('ManagerHand already exists');
}
