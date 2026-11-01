#!/usr/bin/env python3
"""Run the actual bounded controller against isolated command/file fixtures."""
import json, os, shlex, shutil, subprocess, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DRIVER = REPO / 'openwrt/failover/tollgate-failover'
DISABLED = "# TollGate owner failover v1\nconfig globals 'globals'\n\toption mmx_mask '0x3f00'\n\toption tg_owned '1'\n\toption tg_version '1'\n\toption tg_enabled '0'\n"

STUB = r'''#!/usr/bin/env python3
import json, os, re, shlex, sys
from pathlib import Path
r=Path(os.environ['TOLLGATE_FAILOVER_ROOT']); name='mwan3-init' if '/etc/init.d/' in sys.argv[0] else Path(sys.argv[0]).name; a=sys.argv[1:]
p=r/'state.json'; s=json.loads(p.read_text()); s.setdefault('calls',[]).append([name]+a)
def save(): p.write_text(json.dumps(s))
def fail(msg='fixture failure'): save(); print(msg,file=sys.stderr);sys.exit(1)
def mwan():
 d={}; section=None
 for line in (r/'etc/config/mwan3').read_text().splitlines():
  parts=shlex.split(line,comments=True)
  if not parts:continue
  if parts[0]=='config': section=parts[2];d[section]={'.type':parts[1]}
  elif parts[0]=='option':d[section][parts[1]]=parts[2]
  elif parts[0]=='list':d[section].setdefault(parts[1],[]).append(parts[2])
 return d
if name=='uci':
 a=[x for x in a if x!='-q'];cmd=a[0]
 if cmd=='get':
  k=a[1];parts=k.split('.'); cfg=parts.pop(0)
  d=mwan() if cfg=='mwan3' else s.get(cfg,{})
  try:
   for part in parts:d=d[part]
  except (KeyError,TypeError):fail('not found')
  print(d['.type'] if isinstance(d,dict) else d)
 elif cmd=='changes':
  if s.get('changes_fail'):fail()
  print(s.get('staged',''))
 elif cmd in ('set','delete'):
  expr=a[1];k,_,v=expr.partition('=');cfg,sec,key=k.split('.')
  if cmd=='set':s[cfg][sec][key]=v
  else:s[cfg][sec].pop(key,None)
 elif cmd=='commit':
  if s.get('commit_fail'):fail()
  (r/'etc/config/network').write_text(json.dumps(s['network'],sort_keys=True))
 else:fail('unsupported uci '+str(a))
elif name=='ubus':
 if a[:2]==['call','service']:
  print(json.dumps({'mwan3':{'instances':{'rtmon_ipv4':{'running':s.get('running',False)}}}}))
 elif a[:2]==['call','mwan3']:
  if s.get('rpc_fail'):fail()
  ifaces={k:{'up':k in s.get('up',['wwan']),'enabled':True,'running':s.get('running',False),'tracking':'active','status':s.get('health',{}).get(k,'offline')} for k in ('wan','wwan','wan6','wwan6')}
  active=s.get('active','wwan')
  pol4=s.get('policy4',[] if active=='none' else [{'interface':active,'percent':100}])
  print(json.dumps({'interfaces':ifaces,'policies':{'ipv4':{'tg_failover4':pol4},'ipv6':{} if s.get('rpc_policy6_missing') else {'tg_failover6':[]}}}))
 elif a[:1]==['call'] and a[1].startswith('network.interface.'):
  iface=a[1].split('.')[-1];print(json.dumps({} if s.get('link_read_fail') else {'up':iface in s.get('up',['wwan'])}))
 else:fail('unsupported ubus '+str(a))
elif name=='jsonfilter':
 try:
  d=json.load(sys.stdin); expr=a[a.index('-e')+1].removeprefix('@.'); toks=re.findall(r'[^.\[\]]+',expr)
  for key in toks:d=d[int(key)] if isinstance(d,list) else d[key]
  print('[ ]' if d==[] and s.get('spaced_empty') else json.dumps(d,separators=(',',':')) if isinstance(d,(dict,list,bool)) or d is None else d)
 except (KeyError,IndexError,TypeError,ValueError):sys.exit(1)
elif name in ('iptables','ip6tables'):
 if s.get('iptables_fail'):fail()
 family='4' if name=='iptables' else '6'
 if a[-1:].pop().startswith('mwan3_policy_'):
  if s.get('kernel_policy_missing'):fail()
  chain=a[-1];print('-N '+chain)
  kind=s.get('kernel_policy'+family,'unreachable' if family=='6' or s.get('active')=='none' else 'forward')
  comment='"unreachable"' if s.get('quoted_unreachable') else 'unreachable'
  mark=s.get('unreachable_mark','0x3e00/0x3f00')
  if kind=='unreachable':print('-A '+chain+' -m mark --mark 0x0/0x3f00 -m comment --comment '+comment+' -j MARK --set-xmark '+mark)
  if s.get('extra_policy_action'):print('-A '+chain+' -j RETURN')
 else:
  mark='0x20000/0x20000' if not s.get('mark_overlap') else '0x100/0xff00'
  if s.get('running') and not s.get('missing_rule'):
   print('-A mwan3_rules -m mark --mark 0x0/0x3f00 -j mwan3_policy_tg_failover'+family)
  if a[-1:]!=['mwan3_rules']:print('-A ndsOUT -j MARK --set-xmark '+mark)

elif name=='ip':
 if 'rule' in a:
  print(s.get('rules'+('6' if '-6' in a else '4'),s.get('rules','0: from all lookup local\n32766: from all lookup main\n32767: from all lookup default')))
 elif 'route' in a:
  out=s.get('routes'+('6' if '-6' in a else '4'),s.get('routes',''))
  if s.get('table_alias') and '-N' not in a:out=out.replace('table 100','table venue_alias')
  print(out)
 else:fail('unsupported ip')
elif name=='mwan3-init':
 if a[0] in ('start','stop') and s.get(a[0]+'_fail'):fail()
 if a[0]=='start':s['running']=True
 if a[0]=='stop':s['running']=False
elif name=='ipset':pass
else:fail('unknown '+name)
save()
'''

class ControllerTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='tg-failover-');self.root=Path(self.tmp.name)
  for d in ['etc/config','etc/init.d','usr/sbin','usr/libexec/tollgate','lib/mwan3','var/lock','var/run','bin']:(self.root/d).mkdir(parents=True,exist_ok=True)
  (self.root/'etc/config/mwan3').write_text(DISABLED)
  self.state={'network':{'wan':{'.type':'interface','metric':'2','proto':'dhcp'},'wwan':{'.type':'interface','metric':'1','proto':'dhcp'},'wan6':{'.type':'interface','proto':'dhcpv6'}},'running':False,'health':{'wwan':'online'},'calls':[]}
  self.write_state()
  (self.root/'etc/config/network').write_text('original exact network bytes\n')
  (self.root/'usr/sbin/mwan3track').write_text('# TollGate bound DNS/HTTP tracker extension v1\n# tollgate-http\n')
  (self.root/'lib/mwan3/mwan3.sh').write_text('# stock compatible controller\n')
  (self.root/'usr/libexec/tollgate/uplink-probe').write_text('#!/bin/sh\nexit 0\n');(self.root/'usr/libexec/tollgate/uplink-probe').chmod(0o755)
  stub=self.root/'bin/stub';stub.write_text(STUB);stub.chmod(0o755)
  for name in ['uci','ubus','jsonfilter','iptables','ip6tables','ip','ipset']:(self.root/'bin'/name).symlink_to(stub)
  (self.root/'etc/init.d/mwan3').symlink_to(stub)
  (self.root/'bin/mwan3-init').symlink_to(stub)
  self.env=dict(os.environ,TOLLGATE_FAILOVER_ROOT=str(self.root),PATH=str(self.root/'bin')+':'+os.environ['PATH'])
 def tearDown(self):self.tmp.cleanup()
 def write_state(self):(self.root/'state.json').write_text(json.dumps(self.state))
 def read_state(self):self.state=json.loads((self.root/'state.json').read_text());return self.state
 def run_driver(self,action):
  result=subprocess.run(['sh',str(DRIVER),action],env=self.env,text=True,capture_output=True)
  self.assertEqual(result.returncode,0,result.stderr)
  try:return json.loads(result.stdout)
  except ValueError:self.fail(result.stdout+'\n'+result.stderr)
 def test_status_never_mutates_and_reports_disabled(self):
  result=self.run_driver('status');self.assertTrue(result['supported']);self.assertFalse(result['enabled']);self.assertEqual(result['ipv4']['active'],'unknown')
  self.assertFalse(any(c[0]=='mwan3-init' or (c[0]=='uci' and any(x in c for x in ['set','delete','commit'])) for c in self.read_state()['calls']))
 def test_enable_profile_has_priority_health_and_ipv6_fail_closed(self):
  result=self.run_driver('enable');self.assertTrue(result['success'],result);self.assertTrue(result['enabled']);self.assertEqual(result['ipv4']['active'],'wwan');self.assertEqual(result['ipv6']['active'],'none')
  text=(self.root/'etc/config/mwan3').read_text();self.assertIn("option track_method 'tollgate-http'",text);self.assertIn("option down '3'",text);self.assertIn("option initial_state 'offline'",text);self.assertIn("option last_resort 'unreachable'",text)
  state=self.read_state();self.assertEqual(state['network']['wan']['metric'],'2');self.assertEqual(state['network']['wwan']['metric'],'1');self.assertFalse(any(c[0]=='uci' and any(x in c for x in ['set','delete','commit']) for c in state['calls']))
  self.assertEqual((self.root/'etc/tollgate/failover/network.before').read_text(),'original exact network bytes\n')
  self.assertEqual((self.root/'etc/tollgate/failover/network.before').stat().st_mode&0o777,0o600)
  self.assertFalse(any('reload' in c or 'restart' in c for c in state['calls']))
 def test_disable_leaves_all_network_settings_and_unrelated_edits_untouched(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['network']['wan']['hostname']='keep-this-change';self.write_state()
  result=self.run_driver('disable');self.assertTrue(result['success'],result);s=self.read_state();self.assertEqual(s['network']['wan']['metric'],'2');self.assertEqual(s['network']['wwan']['metric'],'1');self.assertNotIn('metric',s['network']['wan6']);self.assertEqual(s['network']['wan']['hostname'],'keep-this-change')
 def test_foreign_profile_refused_without_writes(self):
  (self.root/'etc/config/mwan3').write_text("config globals 'globals'\n")
  self.assertFalse(self.run_driver('enable')['success']);self.assertFalse(self.read_state()['running'])
 def test_foreign_rules_and_mark_conflicts_refuse_first_enable(self):
  for key,value in [('rules','1001: from all lookup 100'),('mark_overlap',True),('routes','default dev wg0 table 100')]:
   with self.subTest(key=key):
    self.state[key]=value;self.write_state();self.assertFalse(self.run_driver('enable')['success']);self.assertFalse(self.read_state()['running']);self.state.pop(key)
 def test_metrics_changed_elsewhere_are_preserved_on_disable(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['network']['wan']['metric']='99';self.write_state()
  result=self.run_driver('disable');self.assertTrue(result['success'],result);self.assertFalse(self.read_state()['running']);self.assertEqual(self.state['network']['wan']['metric'],'99')
 def test_start_failure_is_partial_and_never_retried(self):
  self.state['start_fail']=True;self.write_state();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertIn('partial',result['error']);self.assertTrue(result['enabled']);self.assertEqual(sum(c==['mwan3-init','start'] for c in self.read_state()['calls']),1)
 def test_missing_applied_policy_does_not_claim_main_route(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['rpc_fail']=True;self.write_state();self.assertEqual(self.run_driver('status')['ipv4']['active'],'unknown')
 def test_lock_rejects_duplicate_mutation(self):
  (self.root/'var/lock/tollgate-failover.lock').mkdir();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertIn('busy',result['error']);self.assertFalse(self.read_state()['running'])
 def test_missing_probe_disables_capability(self):
  (self.root/'usr/libexec/tollgate/uplink-probe').unlink();result=self.run_driver('status');self.assertFalse(result['supported']);self.assertFalse(self.run_driver('enable')['success'])

 def test_new_enable_cycle_never_changes_operator_metrics(self):
  self.assertTrue(self.run_driver('enable')['success']);self.assertTrue(self.run_driver('disable')['success']);self.read_state();self.state['network']['wan']['metric']='77';self.write_state()
  self.assertTrue(self.run_driver('enable')['success']);self.assertTrue(self.run_driver('disable')['success']);self.assertEqual(self.read_state()['network']['wan']['metric'],'77')
 def test_status_link_state_survives_engine_read_failure(self):
  self.state['rpc_fail']=True;self.write_state();result=self.run_driver('status');self.assertTrue(result['ipv4']['backup']['link_up']);self.assertEqual(result['ipv4']['backup']['health'],'unavailable')
 def test_configured_but_stopped_engine_is_not_successful_idempotent_enable(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['running']=False;self.write_state();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertFalse(result['controller_running'])
 def test_external_profile_change_is_never_overwritten(self):
  self.assertTrue(self.run_driver('enable')['success']);p=self.root/'etc/config/mwan3';p.write_text(p.read_text()+'# owner changed this\n');result=self.run_driver('disable');self.assertFalse(result['success']);self.assertTrue(self.read_state()['running'])
 def test_staged_or_bonding_settings_refuse_before_mutation(self):
  self.state['staged']='network.wan.metric=33';self.write_state();self.assertFalse(self.run_driver('enable')['success']);self.state['staged']='';self.write_state()
  (self.root/'etc/tollgate').mkdir(exist_ok=True);(self.root/'etc/tollgate/config.json').write_text('{"mptcp_bonding":{"enabled":true}}');self.assertFalse(self.run_driver('enable')['success'])

 def test_active_is_applied_policy_not_preference_or_health(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['up']=['wan','wwan'];self.state['health']['wan']='online';self.state['active']='wwan';self.write_state();self.assertEqual(self.run_driver('status')['ipv4']['active'],'wwan')
 def test_missing_catchall_or_ambiguous_policy_returns_unknown(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['missing_rule']=True;self.write_state();self.assertEqual(self.run_driver('status')['ipv4']['active'],'unknown')
  self.read_state();self.state.pop('missing_rule');self.state['policy4']=[{'interface':'wan','percent':50},{'interface':'wwan','percent':50}];self.write_state();self.assertEqual(self.run_driver('status')['ipv4']['active'],'unknown')
 def test_transition_health_and_failed_link_read_are_truthful(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['health']['wwan']='connecting';self.write_state();self.assertEqual(self.run_driver('status')['ipv4']['backup']['health'],'checking')
  self.read_state();self.state['link_read_fail']=True;self.write_state();self.assertIsNone(self.run_driver('status')['ipv4']['backup']['link_up'])
 def test_unmarked_tracker_upgrade_is_unsupported(self):
  (self.root/'usr/sbin/mwan3track').write_text('# future version with tollgate-http mentioned but not integrated\n');result=self.run_driver('status');self.assertFalse(result['supported']);self.assertFalse(self.run_driver('enable')['success'])
 def test_unrecognized_cli_arguments_are_not_executed(self):
  result=self.run_driver('enable; echo injected');self.assertFalse(result['success']);self.assertFalse(self.read_state()['running'])

 def test_ipv6_wifi_backup_is_not_claimed_from_router_health_alone(self):
  self.state['network']['wwan6']={'.type':'interface','proto':'dhcpv6','metric':'88'};self.state['up']=['wwan','wwan6'];self.state['health']['wwan6']='online';self.write_state();result=self.run_driver('enable');self.assertTrue(result['success']);self.assertFalse(result['ipv6']['backup_supported']);self.assertEqual(result['ipv6']['backup']['health'],'unavailable');self.assertEqual(result['ipv6']['backup']['reason'],'ipv6-backup-unsupported')
  text=(self.root/'etc/config/mwan3').read_text();self.assertNotIn("config interface 'wwan6'",text);self.assertNotIn("list use_member 'tg_wwan6'",text);self.assertEqual(self.read_state()['network']['wwan6']['metric'],'88');self.assertTrue(self.run_driver('disable')['success']);self.assertEqual(self.read_state()['network']['wwan6']['metric'],'88')
 def test_failed_pending_edit_read_refuses_before_writes(self):
  self.state['changes_fail']=True;self.write_state();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertFalse(any(c[0]=='uci' and any(x in c for x in ['set','delete','commit']) for c in self.read_state()['calls']))

 def test_foreign_table_in_unused_family_is_not_flushed_on_disable(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['routes4']='default dev vpn0 table 3';self.write_state();result=self.run_driver('disable');self.assertFalse(result['success']);self.assertTrue(self.read_state()['running'])
 def test_exact_owned_family_tables_allow_cleanup(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['routes4']='default dev eth0 table 1\ndefault dev wlan0 table 2';self.state['routes6']='default dev eth0 table 3';self.state['rules']='0: from all lookup local\n32766: from all lookup main';self.write_state();self.assertTrue(self.run_driver('disable')['success'])

 def test_native_jsonfilter_spaced_empty_policy_is_none(self):
  self.state['spaced_empty']=True;self.state['active']='none';self.write_state();result=self.run_driver('enable');self.assertTrue(result['success']);self.assertEqual(result['ipv4']['active'],'none');self.assertEqual(result['ipv6']['active'],'none')

 def test_network_file_and_metrics_are_untouched_through_complete_cycle(self):
  before=(self.root/'etc/config/network').read_bytes(); network=json.loads(json.dumps(self.state['network']))
  self.assertTrue(self.run_driver('enable')['success']);self.assertEqual((self.root/'etc/config/network').read_bytes(),before)
  self.assertTrue(self.run_driver('disable')['success']);self.assertEqual((self.root/'etc/config/network').read_bytes(),before);self.assertEqual(self.read_state()['network'],network)
  self.assertFalse(any(c[0]=='uci' and any(x in c for x in ['set','delete','commit']) for c in self.state['calls']))
 def test_equal_or_invalid_main_metrics_refuse_before_profile_enable(self):
  for left,right in [('1','1'),(None,None),('0','00'),('-1','2'),('two','1')]:
   with self.subTest(metrics=(left,right)):
    self.state['network']['wan'].pop('metric',None);self.state['network']['wwan'].pop('metric',None)
    if left is not None:self.state['network']['wan']['metric']=left
    if right is not None:self.state['network']['wwan']['metric']=right
    self.write_state();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertIn('LuCI',result['error']);self.assertFalse(self.read_state()['running'])
 def test_partial_enable_never_writes_network_file_or_metrics(self):
  self.state['start_fail']=True;self.write_state();before=(self.root/'etc/config/network').read_bytes();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertEqual((self.root/'etc/config/network').read_bytes(),before);self.assertEqual(self.read_state()['network']['wan']['metric'],'2')
 def test_verified_native_ipv6_failed_policy_rule_does_not_block_disable(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();path=self.root/'sys/class/net/eth0';path.mkdir(parents=True);(path/'ifindex').write_text('2\n');self.state['rules6']='0: from all lookup local\n32766: from all lookup main\n4200000002: from all iif eth0 failed_policy';self.write_state();self.assertTrue(self.run_driver('disable')['success'])
 def test_native_rule_allowlist_rejects_wrong_index_or_extra_selector(self):
  path=self.root/'sys/class/net/eth0';path.mkdir(parents=True);(path/'ifindex').write_text('2\n')
  for rule in ['4200000003: from all iif eth0 failed_policy','4200000002: from all iif eth0 lookup 100','4200000002: from 2001:db8::/64 iif eth0 failed_policy']:
   with self.subTest(rule=rule):
    self.state['rules6']='0: from all lookup local\n32766: from all lookup main\n'+rule;self.write_state();self.assertFalse(self.run_driver('enable')['success']);self.assertFalse(self.read_state()['running'])

 def test_native_delegated_ipv6_prefix_reject_guard_is_preserved(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();path=self.root/'sys/class/net/br-lan';path.mkdir(parents=True);(path/'ifindex').write_text('3\n');self.state['rules6']='0: from all lookup local\n32766: from all lookup main\n4200000000: from 2001:db8:1234::/64 iif br-lan unreachable';self.write_state();self.assertTrue(self.run_driver('disable')['success'])

 def test_missing_rpc_policy_is_none_with_exact_unquoted_kernel_unreachable(self):
  self.state['rpc_policy6_missing']=True;self.write_state();result=self.run_driver('enable');self.assertTrue(result['success']);self.assertEqual(result['ipv6']['active'],'none');self.assertEqual(result['ipv4']['active'],'wwan')
 def test_quoted_kernel_unreachable_comment_is_also_supported(self):
  self.state['rpc_policy6_missing']=True;self.state['quoted_unreachable']=True;self.write_state();result=self.run_driver('enable');self.assertTrue(result['success']);self.assertEqual(result['ipv6']['active'],'none')
 def test_empty_rpc_policy_without_exact_kernel_evidence_is_unknown(self):
  self.state['kernel_policy6']='absent';self.write_state();result=self.run_driver('enable');self.assertTrue(result['success']);self.assertEqual(result['ipv6']['active'],'unknown')
 def test_unreachable_fallback_rejects_other_mark_or_additional_action(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state();self.state['rpc_policy6_missing']=True;self.state['unreachable_mark']='0x3f00/0x3f00';self.write_state();self.assertEqual(self.run_driver('status')['ipv6']['active'],'unknown')
  self.read_state();self.state.pop('unreachable_mark');self.state['extra_policy_action']=True;self.write_state();self.assertEqual(self.run_driver('status')['ipv6']['active'],'unknown')

 def test_numeric_route_output_reveals_foreign_table_alias(self):
  self.state['routes4']='default dev vpn0 table 100';self.state['table_alias']=True;self.write_state();result=self.run_driver('enable');self.assertFalse(result['success']);self.assertFalse(self.read_state()['running']);self.assertTrue(all('-N' in c for c in self.state['calls'] if c[0]=='ip'))

 def test_actual_numeric_ip_full_actions_allow_owned_cleanup(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state()
  self.state['rules4']='0: from all lookup 255\n1002: from all iif phy0-sta0 lookup 2\n2002: from all fwmark 0x200/0x3f00 lookup 2\n2061: from all fwmark 0x3d00/0x3f00 6\n2062: from all fwmark 0x3e00/0x3f00 7\n3002: from all fwmark 0x200/0x3f00 7\n32766: from all lookup 254\n32767: from all lookup 253'
  self.state['rules6']='0: from all lookup 255\n2061: from all fwmark 0x3d00/0x3f00 6\n2062: from all fwmark 0x3e00/0x3f00 7\n32766: from all lookup 254';self.write_state();result=self.run_driver('disable');self.assertTrue(result['success'],result);self.assertFalse(self.read_state()['running'])
 def test_native_numeric_reject_actions_require_the_same_provenance(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state()
  for dev,index in [('eth0','2'),('br-lan','3')]:
   p=self.root/'sys/class/net'/dev;p.mkdir(parents=True);(p/'ifindex').write_text(index+'\n')
  self.state['rules6']='0: from all lookup 255\n32766: from all lookup 254\n4200000002: from all iif eth0 12\n4200000000: from 2001:db8:1234::/64 iif br-lan 7';self.write_state();self.assertTrue(self.run_driver('disable')['success'])
 def test_numeric_actions_do_not_weaken_mark_or_priority_ownership(self):
  self.assertTrue(self.run_driver('enable')['success']);self.read_state()
  for rule in ['2061: from all fwmark 0x3d00/0x3f00 7','2062: from all fwmark 0x3d00/0x3f00 7','3002: from all fwmark 0x100/0x3f00 7','2002: from all fwmark 0x100/0x3f00 lookup 2']:
   with self.subTest(rule=rule):
    self.state['rules4']='0: from all lookup 255\n32766: from all lookup 254\n'+rule;self.write_state();self.assertFalse(self.run_driver('disable')['success']);self.assertTrue(self.read_state()['running'])

if __name__=='__main__':unittest.main()
