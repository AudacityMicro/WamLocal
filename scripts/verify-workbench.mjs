import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

/** Shared smoke flow for the current empty-workspace Jobs UI. Uses disposable browser/userData state. */
export async function verifyWorkbench(page) {
  page.setDefaultTimeout(15000);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Jobs',exact:true}).click();
  await page.getByRole('button',{name:'New part',exact:true}).click();
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await page.getByRole('tab',{name:'Cuts & tabs',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Lead length',exact:true}).fill('3.5');
  await page.getByRole('button',{name:'Done editing',exact:true}).click();
  // Native OS file dialogs are covered separately; feed the same job into the
  // renderer's input so this smoke test is deterministic in both runtimes.
  await page.locator('input[type=file][accept=".wam,.json"]').setInputFiles({
    name:'preset-actions.wam',mimeType:'application/json',buffer:await readFile('fixtures/posting/two-sheets.wam'),
  });
  await page.getByRole('heading',{name:'Posting verification',exact:true}).waitFor();
  const choosePreset=async()=>{
    await page.getByRole('button',{name:'Presets',exact:true}).click();
    await page.getByRole('combobox',{name:'Material family preset database',exact:true}).selectOption('Metal');
    await page.getByRole('combobox',{name:'Material class preset database',exact:true}).selectOption('Aluminum');
    await page.getByRole('combobox',{name:'Material preset database',exact:true}).selectOption({label:'6061'});
    await page.getByRole('combobox',{name:'Thickness preset database',exact:true}).selectOption('0.5080');
  };
  await choosePreset();
  await page.getByRole('combobox',{name:'Quality preset database',exact:true}).selectOption('pro-0-0.02-medium');
  await page.getByRole('button',{name:'Use preset in this job',exact:true}).click();
  await page.getByRole('button',{name:'Jobs',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'Post sheet Sheet 1',exact:true}).isEnabled());
  assert.ok(await page.getByRole('button',{name:'Post sheet Sheet 2',exact:true}).isEnabled());
  await choosePreset();
  await page.getByRole('combobox',{name:'Quality preset database',exact:true}).selectOption('pro-0-0.02-medium');
  await page.getByRole('button',{name:'Delete preset',exact:true}).click();
  await page.reload();
  await choosePreset();
  assert.equal(await page.locator('option[value="pro-0-0.02-medium"]').count(),0);
  await page.getByRole('combobox',{name:'Quality preset database',exact:true}).selectOption('pro-0-0.02-fine');
  await page.getByRole('button',{name:'Use preset in this job',exact:true}).click();
  await page.getByRole('button',{name:'Jobs',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Material job',exact:true}).inputValue(),'Aluminum - 6061');
  assert.equal(await page.getByRole('combobox',{name:'Thickness job',exact:true}).inputValue(),'0.5080');
}
