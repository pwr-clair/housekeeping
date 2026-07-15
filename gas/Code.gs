// ============================================================
// Paradise Walk — 자동화 서버 v5 (통합본)
// 포함: SIRVOY webhook / 6단계 메일 / 자동전환 / 수동발송(sendStage)
// [버전관리] 2026-07-14부터 이 파일이 정본(housekeeping 레포 /gas/Code.gs).
//   GAS 에디터(PWR-HK-Engine)에 전문 붙여넣기로 반영.
// [패치 2026-07-14] previewStage/sendStageEdited가 custom_* 단계(발송탭 [안내]
//   커스텀 템플릿, app/mailTemplates/custom_{ts})를 허용.
// ============================================================

const FB = 'https://paradise-walk-residence-default-rtdb.asia-southeast1.firebasedatabase.app';
const FB_AUTH = PropertiesService.getScriptProperties().getProperty('FB_AUTH');
const SENDER = 'paradisewalkresidence@gmail.com';
const ADMIN_EMAIL = 'joi.hurricane@gmail.com';
const APPROVE_TOKEN = PropertiesService.getScriptProperties().getProperty('APPROVE_TOKEN');
function roomNums(){
  var rooms = fbGet('app/rooms') || {};
  return Object.keys(rooms).sort(function(a,b){ return (+a) - (+b); });
}

// ─── Firebase REST ───────────────────────────────────────────
function fbGet(p){const r=UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{muteHttpExceptions:true});return JSON.parse(r.getContentText());}
function fbSet(p,d){UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{method:'put',contentType:'application/json',payload:JSON.stringify(d),muteHttpExceptions:true});}
function fbUpdate(p,d){UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{method:'patch',contentType:'application/json',payload:JSON.stringify(d),muteHttpExceptions:true});}
function fbDelete(p){UrlFetchApp.fetch(FB+'/'+p+'.json'+(FB_AUTH?'?auth='+FB_AUTH:''),{method:'delete',muteHttpExceptions:true});}

// ─── 유틸 ────────────────────────────────────────────────────
function kstDate(o){return Utilities.formatDate(new Date(Date.now()+(o||0)*864e5),'Asia/Seoul','yyyy-MM-dd');}
function todayKST(){return kstDate(0);}
function nowHM(){return Utilities.formatDate(new Date(),'Asia/Seoul','HH:mm');}
function nowMinKST(){return +Utilities.formatDate(new Date(),'Asia/Seoul','H')*60 + +Utilities.formatDate(new Date(),'Asia/Seoul','m');}
function floorOf(room){return String(room).length===3?String(room)[0]:String(room).slice(0,2);}
function normSource(s){s=String(s||'').toLowerCase();if(s.includes('booking'))return 'booking';if(s.includes('agoda'))return 'agoda';if(s.includes('expedia'))return 'expedia';return 'direct';}

// ─── ETA → rooms.checkinTime 동기화 ───
function etaStart(eta){
  if(!eta) return '';
  var em = String(eta).match(/^(\d{1,2}):(\d{2})/);
  if(!em) return '';
  return String(em[1]).padStart(2,'0') + ':' + em[2];
}
function syncEtaToRoom(bookingId, eta){
  if(!bookingId) return;
  var ci = etaStart(eta);
  if(!ci) return;
  var rooms = fbGet('app/rooms') || {};
  Object.keys(rooms).forEach(function(rm){
    var r = rooms[rm]; if(!r) return;
    var changed = false;
    if(r.currentBooking && String(r.currentBooking.bookingId) === String(bookingId)){
      if(r.currentBooking.checkinTime !== ci){ r.currentBooking.checkinTime = ci; changed = true; }
    }
    if(Array.isArray(r.nextBookings)){
      r.nextBookings.forEach(function(b){
        if(b && String(b.bookingId) === String(bookingId) && b.checkinTime !== ci){
          b.checkinTime = ci; changed = true;
        }
      });
    }
    if(changed) fbSet('app/rooms/'+rm, r);
  });
}
function syncAllEtaToRooms(){
  var pend = fbGet('app/pendingBookings') || {};
  var count = 0;
  Object.keys(pend).forEach(function(k){
    var p = pend[k];
    if(p && p.eta && p.bookingId && !p.cancelled){
      syncEtaToRoom(p.bookingId, p.eta);
      count++;
    }
  });
  Logger.log('syncAllEtaToRooms: processed '+count+' pending entries');
  return count;
}

function sendMail(to, subject, body){
  var opts = { from: SENDER };
  var bcc = fbGet('app/config/bccEmail');
  if(bcc) opts.bcc = bcc;
  GmailApp.sendEmail(to, subject, body, opts);
}
function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// ============================================================
// SIRVOY Webhook 수신
// ============================================================
function doPost(e){
  try{
    const b=JSON.parse(e.postData.contents);
    const id='sv_'+b.bookingId;
    const pend=fbGet('app/pendingBookings')||{};
    const chId=String(b.channelBookingId||'');
    const gName=((b.guest&&b.guest.lastName)||'')+', '+((b.guest&&b.guest.firstName)||'');
    let foundKey=null;
    const inBkId=String(b.bookingId||'');
    for(const [k,v] of Object.entries(pend)){
      if(!v)continue;
      if(inBkId&&String(v.bookingId||'').indexOf('_')<0&&String(v.bookingId||'')===inBkId){foundKey=k;break;}
      if(chId&&String(v.channelBookingId||'')===chId){foundKey=k;break;}
      if(!chId&&v.guest===gName&&v.checkinDate===(b.arrivalDate||'')&&v.checkoutDate===(b.departureDate||'')){foundKey=k;break;}
    }
    const targetKey=foundKey||id;
    const prev=pend[targetKey]||{};

    if(b.event==='cancelled'||b.cancelled===true){
      fbUpdate('app/pendingBookings/'+targetKey,{cancelled:true});
      return ContentService.createTextOutput('OK');
    }

    const raw=((b.guest&&b.guest.message)||'')+' ; '+(b.internalComment||'');
    let eta=b.eta||'';
    let m=raw.match(/arrival\s*time\s*:?\s*(\d{1,2})[\s:h.]*(\d{2})?\s*(?:-\s*(\d{1,2})[\s:h.]*(\d{2})?)?/i);
    if(!m)m=raw.match(/time of arrival\s*:?\s*(?:between\s*)?(\d{1,2})[\s:h.]*(\d{2})?\s*(?:and|-)\s*(\d{1,2})[\s:h.]*(\d{2})?/i);
    if(!eta&&m){
      eta=m[1]+':'+(m[2]||'00');
      if(m[3])eta+='-'+m[3]+':'+(m[4]||'00');
    }
        const notes=raw
        .replace(/approximate time of arrival\s*:?[^;\n]*/ig,'')
        .replace(/time of arrival\s*:?[^;\n]*/ig,'')
        .replace(/arrival\s*time\s*:?[^;\n]*/ig,'')
        .replace(/benefits?\s*:[^;\n]*;?/ig,'')
        .replace(/channel\s*name\s*:[^;\n]*;?/ig,'')
        .replace(/this booking includes[^.;\n]*[.;]?/ig,'')
        .replace(/etp\s*:[^;\n]*;?/ig,'')
        .replace(/remittance amount\s*:?[^;\n]*/ig,'')
        .replace(/brand\s*:?\s*[^;\n]*/ig,'')
        .replace(/hotel collect\s*booking collect\s*payment from guest\.*/ig,'')
        .replace(/(agoda|expedia)\s*collect\.?/ig,'')
        .replace(/\*+\s*this reservation has been pre-?paid\s*\*+/ig,'')
        .replace(/reservation has a cancellation grace period\.?[^.]*\d{4}-\d{2}-\d{2}[\s\d:]*\.?/ig,'')
        .replace(/booking note\s*:?\s*payment charge is[^;\n]*/ig,'')
        .replace(/booker is genius\.?/ig,'')
        .replace(/^\s*\d*\s*(?:queen|king|double|twin|single)\s*bed\s*$/gim,'')
        .replace(/^\s*non[-\s]?smoking\s*$/gim,'')
        .replace(/the phone number[\s\S]*?phone number"?\s*field\.?/ig,'')
        .replace(/(?:special\s*)?requests?\s*:\s*/ig,'')
        .replace(/\(the next day\)/ig,'')
        .replace(/[;,]\s*$/g,'')
        .replace(/^[\s;,.\-]+|[\s;,.\-]+$/g,'')
        .replace(/\s{2,}/g,' ').trim();

    var __rooms = (b && Array.isArray(b.rooms)) ? b.rooms : [];
    if (__rooms.length >= 2) {
      __rooms.forEach(function(__rm){
        var __rn = String((__rm && __rm.RoomName) || '').trim();
        if (!__rn) return;
        var __mkey = targetKey + '_' + __rn;
        var __mprev = (pend && pend[__mkey]) || {};
        fbSet('app/pendingBookings/'+__mkey, {
          bookingId:__mprev.bookingId||(String(b.bookingId)+'_'+__rn),
          channelBookingId:chId||__mprev.channelBookingId||'',
          source:b.bookingSource||__mprev.source||'',
          guest:gName,
          guestEmail:(b.guest&&b.guest.email)||__mprev.guestEmail||'',
          guestPhone:(b.guest&&b.guest.phone)||__mprev.guestPhone||'',
          checkinDate:(__rm.arrivalDate||b.arrivalDate||''),checkoutDate:(__rm.departureDate||b.departureDate||''),
          eta:eta,notes:notes,
          cancelled:false,
          assignedRoom:__mprev.assignedRoom||null,
          receivedAt:__mprev.receivedAt||(todayKST()+' '+nowHM())
        });
        syncEtaToRoom(__mprev.bookingId || String(b.bookingId), eta);
      });
    } else {
      fbSet('app/pendingBookings/'+targetKey,{
      bookingId:prev.bookingId||String(b.bookingId),
      channelBookingId:chId||prev.channelBookingId||'',
      source:b.bookingSource||prev.source||'',
      guest:gName,
      guestEmail:(b.guest&&b.guest.email)||prev.guestEmail||'',
      guestPhone:(b.guest&&b.guest.phone)||prev.guestPhone||'',
      checkinDate:b.arrivalDate||'',checkoutDate:b.departureDate||'',
      eta:eta,notes:notes,
      cancelled:false,
      assignedRoom:prev.assignedRoom||null,
      receivedAt:prev.receivedAt||(todayKST()+' '+nowHM())
    });
    syncEtaToRoom(prev.bookingId || String(b.bookingId), eta);
    }
  }catch(err){}
  return ContentService.createTextOutput('OK');
}

// ============================================================
// 발송 공통
// ============================================================
function sendStageMail(stage,bk,room,force){
    var __nights = (bk && bk.checkinDate && bk.checkoutDate)
      ? Math.round((new Date(bk.checkoutDate) - new Date(bk.checkinDate)) / 86400000)
      : null;
    if(__nights === 1){
      if(stage === 's3_checkin') stage = 's34_combined';
      else if(stage === 's4_checkout') return false;
    }
  if(!bk.guestEmail)return false;
  if(!force){
    const cfg=fbGet('app/mailConfig')||{};
    const gateStage=(stage==='s34_combined')?'s3_checkin':stage;   // s34_combined = 입실안내 1박변형 -> s3_checkin 토글로 게이팅
    if(!((cfg.stages||{})[gateStage]))return false;
    if(!((cfg.sources||{})[normSource(bk.source)]))return false;
  }
  const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_'+stage;
  if(fbGet('app/mailLogs/'+logKey))return false;
  const tpl=fbGet('app/mailTemplates/'+stage);
  if(!tpl||!tpl.subject)return false;
  const r=room?(fbGet('app/rooms/'+room)||{}):{};
  const fill=s=>String(s)
    .replace(/{guest}/g,bk.guest||'Guest').replace(/{checkinDate}/g,bk.checkinDate||'')
    .replace(/{checkoutDate}/g,bk.checkoutDate||'').replace(/{room}/g,room||'')
    .replace(/{floor}/g,room?floorOf(room):'').replace(/{doorPw}/g,r.doorPw||'')
    .replace(/{reviewGuide}/g,reviewGuideFor(bk.source));
  try{
    var __subject = fill(tpl.subject);
    var __ko = (tpl.bodyKo && String(tpl.bodyKo).trim()) ? fill(tpl.bodyKo) : '';
    var __en = (tpl.bodyEn && String(tpl.bodyEn).trim()) ? fill(tpl.bodyEn) : '';
    if(__ko || __en){
      if(__ko) sendMail(bk.guestEmail, __subject, __ko);
      if(__en) sendMail(bk.guestEmail, __subject, __en);
    } else {
      var __body = (tpl.body && String(tpl.body).trim()) ? fill(tpl.body) : '';
      if(__body) sendMail(bk.guestEmail, __subject, __body);
    }
    fbSet('app/mailLogs/'+logKey,{stage,time:todayKST()+' '+nowHM(),email:bk.guestEmail,guest:bk.guest,room:room||''});
    return true;
  }catch(err){
    GmailApp.sendEmail(ADMIN_EMAIL,'[PW] '+stage+' 발송 실패: '+bk.guest,String(err));
    return false;
  }
}

function reviewGuideFor(source){
  const k=normSource(source);
  if(k==='booking')return '⭐ How to leave a review (takes 1 minute!)\nOpen the Booking.com app or website → Bookings → select Paradise Walk Residence → "Review your stay"\n(Booking.com will also send you a review invitation by email — either way works!)';
  if(k==='agoda')return '⭐ How to leave a review (takes 1 minute!)\nOpen the Agoda app → My Bookings → select Paradise Walk Residence → "Write a review"\n(Agoda will also send you a review invitation — either way works!)';
  if(k==='expedia')return '⭐ How to leave a review (takes 1 minute!)\nOpen the Expedia or Hotels.com app → Trips → select Paradise Walk Residence → "Write a review"';
  return '';
}

function sendByDate(stage,dateField,targetDate){
  const pend=fbGet('app/pendingBookings')||{};let n=0;
  for(const bk of Object.values(pend)){
    if(!bk||bk.cancelled)continue;
    if(bk[dateField]!==targetDate)continue;
    if(sendStageMail(stage,bk,null,false))n++;
  }
  return n;
}
// 방문고지(s5) 전용 — 객실이 이미 '퇴실완료(checkout_done)'면 발송 skip
function sendS5Visit(){
  const today=todayKST();
  const pend=fbGet('app/pendingBookings')||{};
  const rooms=fbGet('app/rooms')||{};
  // bookingId → 방번호 매핑 (현재 그 방에 든 예약 기준)
  const bidToRoom={};
  for(const num of Object.keys(rooms)){
    const r=rooms[num]; if(!r) continue;
    const cb=r.currentBooking;
    if(cb&&cb.bookingId) bidToRoom[String(cb.bookingId)]=num;
  }
  let n=0;
  for(const bk of Object.values(pend)){
    if(!bk||bk.cancelled)continue;
    if(bk.checkoutDate!==today)continue;        // 오늘 체크아웃 대상
    // 이 예약이 들어있는 방 찾기 → 그 방이 퇴실완료면 skip
    const room=bk.bookingId?bidToRoom[String(bk.bookingId)]:null;
    if(room && rooms[room] && rooms[room].status==='checkout_done') continue;  // ★ 퇴실완료 제외
    if(sendStageMail('s5_checkoutConfirm',bk,null,false))n++;
  }
  return n;
}
// ============================================================
// 마스터 틱 — 5분마다
// ============================================================
function masterTick(){
  const min=nowMinKST();
  syncAmounts();   // 매 틱(5분)마다 금액 동기화
  if(min>=420&&min<430) sendByDate('s2_reminder','checkinDate',kstDate(1));   // ★ 07:00 (KST)
  if(min>=665&&min<675) sendS5Visit();
  if(min>=750&&min<760) sendByDate('s6_review','checkoutDate',kstDate(-1));
  if(min>=1260&&min<1270) sendByDate('s4_checkout','checkoutDate',kstDate(1));

  // ★ 입실안내(s3) — 시각 기반: 매 틱마다 발송창에 든 방을 발송 (승인흐름 제거)
  const mode=fbGet('app/config/sendMode')||'manual';
  if(mode==='auto'){
    sendCheckinDue();                       // 자동: 시각기반 발송
  } else if(mode==='approve'){
    // 승인모드(레거시): 14:30대 하루 1회 승인메일
    if(min>=870&&min<900){
      const asked=fbGet('app/autoSend/approvalAskedDate');
      if(asked!==todayKST()){fbSet('app/autoSend/approvalAskedDate',todayKST());sendApprovalEmail();}
    }
  }
  // mode==='manual' → 아무것도 안 함 (수동 발송만)
  }

// ============================================================
// 입실안내 — 발송 시각 도달 판정
// checkinTime 있으면 그 시각 ±15분, 없으면 14:30~15:00 기본창
// ============================================================
function checkinDueNow(cb){
  var nowMin = parseInt(Utilities.formatDate(new Date(),'Asia/Seoul','HH'),10)*60
             + parseInt(Utilities.formatDate(new Date(),'Asia/Seoul','mm'),10);
  return nowMin >= 870;   // 14:30 이후면 발송 (checkinTime 무관, 참고용일 뿐)
}

function findCheckinDue(){
  const rooms=fbGet('app/rooms')||{},sent=fbGet('app/sentChecks')||{},today=todayKST();
  const due=[];
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    // 오늘 체크인 예약 탐색: currentBooking 우선, 없으면 nextBookings까지 (수동 sendRoom과 동일 —
    // 공실 하루 이상 후 체크인은 11:59 승격 대상이 아니라 nextBookings에 머무름)
    let cb=(r.currentBooking&&r.currentBooking.guest&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b&&b.guest&&b.checkinDate===today)||null;
    }
    if(!cb)continue;
    if(sent[num+'_'+today])continue;           // 이미 발송 → skip
    if(r.status!=='clean_done')continue;        // 청소완료만
    if(!cb.guestEmail)continue;                 // 이메일 있어야
    if(!checkinDueNow(cb))continue;             // ★ 발송 시각 창에 들었나
    due.push({num,r,cb});
  }
  return due;
}

function sendCheckinDue(){
  const due=findCheckinDue(),today=todayKST();let count=0;
  for(const {num,cb} of due){
    const bk={bookingId:cb.bookingId||('room_'+num+'_'+today),source:cb.source||'',
      guest:cb.guest,guestEmail:cb.guestEmail,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    if(sendStageMail('s3_checkin',bk,num,false)){fbSet('app/sentChecks/'+num+'_'+today,today);count++;}
  }
  return count;
}

// 승인메일용 — 오늘 발송 대기 목록 (시각 무관, 참고용)
function findEligible(){
  const rooms=fbGet('app/rooms')||{},sent=fbGet('app/sentChecks')||{},today=todayKST();
  const eligible=[],noEmail=[],notReady=[];
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    const cb=r.currentBooking;if(!cb||!cb.guest)continue;
    if(cb.checkinDate!==today)continue;
    if(sent[num+'_'+today])continue;
    if(r.status!=='clean_done'){notReady.push({num,r});continue;}
    if(!cb.guestEmail){noEmail.push({num,r});continue;}
    eligible.push({num,r});
  }
  return {eligible,noEmail,notReady};
}

function sendEligible(){
  // 승인 버튼용 — 지금 청소완료된 모든 미발송 입실안내 즉시 발송 (시각 무관)
  const {eligible}=findEligible();const today=todayKST();let count=0;
  for(const {num,r} of eligible){
    const cb=r.currentBooking;
    const bk={bookingId:cb.bookingId||('room_'+num+'_'+today),source:cb.source||'',
      guest:cb.guest,guestEmail:cb.guestEmail,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    if(sendStageMail('s3_checkin',bk,num,false)){fbSet('app/sentChecks/'+num+'_'+today,today);count++;}
  }
  return count;
}

function sendApprovalEmail(){
  const {eligible,noEmail,notReady}=findEligible();
  const url=ScriptApp.getService().getUrl();
  let body='오늘('+todayKST()+') 입실안내 발송 대기 목록\n\n';
  if(eligible.length===0)body+='— 발송 대상 없음\n';
  for(const {num,r} of eligible)body+='[발송예정] '+num+'호 | '+r.currentBooking.guest+' | '+(r.currentBooking.source||'?')+' | 비번 '+(r.doorPw||'미설정')+'\n';
  for(const {num,r} of notReady)body+='[청소중] '+num+'호 | '+r.currentBooking.guest+' → 청소완료 후 발송\n';
  for(const {num,r} of noEmail)body+='[이메일없음] '+num+'호 | '+r.currentBooking.guest+'\n';
  if(eligible.length>0)body+='\n▼ 클릭 시 [발송예정] 전체 즉시 발송\n'+url+'?action=approve&token='+APPROVE_TOKEN;
  GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 입실안내 승인 요청 ('+eligible.length+'건)',body);
}

// ============================================================
// 외부 요청 (승인 링크 / 수동 발송)
// ============================================================
function doGet(e){
  const p=e.parameter||{};
  if(p.token!==APPROVE_TOKEN)return ContentService.createTextOutput('Paradise Walk GAS 작동 중');
  if(p.action==='approve'){
    return ContentService.createTextOutput('발송 완료: '+sendEligible()+'건');
  }
  if(p.action==='sendRoom'&&p.room){
    const num=String(p.room),today=todayKST();
    const r=fbGet('app/rooms/'+num);
    if(!r)return ContentService.createTextOutput(num+'호: 객실 정보 없음');
    let cb=(r.currentBooking&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b.checkinDate===today)||null;
    }
    if(!cb||!cb.guest)return ContentService.createTextOutput(num+'호: 오늘 체크인 예약이 없어요');
    if(!cb.guestEmail)return ContentService.createTextOutput(num+'호: 손님 이메일이 없어요');
    const logKey=String(cb.bookingId||('room_'+num+'_'+today)).replace(/[.#$\[\]\/]/g,'_')+'_s3_checkin';
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);fbDelete('app/sentChecks/'+num+'_'+today);}
    else if(fbGet('app/sentChecks/'+num+'_'+today))return ContentService.createTextOutput(num+'호: 이미 발송됨 (재발송 버튼 사용)');
    const bk={bookingId:cb.bookingId||('room_'+num+'_'+today),source:cb.source||'',
      guest:cb.guest,guestEmail:cb.guestEmail,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    if(sendStageMail('s3_checkin',bk,num,true)){
      fbSet('app/sentChecks/'+num+'_'+today,today);
      return ContentService.createTextOutput('✅ '+num+'호 '+cb.guest+'님께 발송 완료');
    }
    return ContentService.createTextOutput(num+'호: 발송 실패');
  }
  if(p.action==='previewRoom'&&p.room){
    const num=String(p.room),today=todayKST();
    const r=fbGet('app/rooms/'+num);
    if(!r)return jsonOut({ok:false,msg:num+'호: 객실 정보 없음'});
    let cb=(r.currentBooking&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b.checkinDate===today)||null;
    }
    if(!cb||!cb.guest)return jsonOut({ok:false,msg:num+'호: 오늘 체크인 예약이 없어요'});
    if(!cb.guestEmail)return jsonOut({ok:false,msg:num+'호: 손님 이메일이 없어요'});
    const nights=(cb.checkinDate&&cb.checkoutDate)?Math.round((new Date(cb.checkoutDate)-new Date(cb.checkinDate))/86400000):null;
    const stage=(nights===1)?'s34_combined':'s3_checkin';
    const tpl=fbGet('app/mailTemplates/'+stage)||{};
    const fill=s=>String(s||'')
      .replace(/{guest}/g,cb.guest||'Guest').replace(/{checkinDate}/g,cb.checkinDate||'')
      .replace(/{checkoutDate}/g,cb.checkoutDate||'').replace(/{room}/g,num)
      .replace(/{floor}/g,floorOf(num)).replace(/{doorPw}/g,r.doorPw||'')
      .replace(/{reviewGuide}/g,reviewGuideFor(cb.source));
    return jsonOut({
      ok:true,room:num,guest:cb.guest,stage:stage,
      alreadySent:!!fbGet('app/sentChecks/'+num+'_'+today),
      subject:fill(tpl.subject||''),
      bodyKo:fill(tpl.bodyKo||(tpl.bodyEn?'':tpl.body||'')),
      bodyEn:fill(tpl.bodyEn||'')
    });
  }
  if(p.action==='sendRoomEdited'&&p.room){
    const num=String(p.room),today=todayKST();
    const ov=fbGet('app/sendOverrides/'+num+'_'+today);
    if(!ov||(!ov.bodyKo&&!ov.bodyEn))return ContentService.createTextOutput(num+'호: 편집 내용이 없어요');
    const r=fbGet('app/rooms/'+num);
    if(!r)return ContentService.createTextOutput(num+'호: 객실 정보 없음');
    let cb=(r.currentBooking&&r.currentBooking.checkinDate===today)?r.currentBooking:null;
    if(!cb){
      const nexts=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      cb=nexts.find(b=>b.checkinDate===today)||null;
    }
    if(!cb||!cb.guest)return ContentService.createTextOutput(num+'호: 오늘 체크인 예약이 없어요');
    if(!cb.guestEmail)return ContentService.createTextOutput(num+'호: 손님 이메일이 없어요');
    const nights=(cb.checkinDate&&cb.checkoutDate)?Math.round((new Date(cb.checkoutDate)-new Date(cb.checkinDate))/86400000):null;
    const stg=(nights===1)?'s34_combined':'s3_checkin';
    const logKey=String(cb.bookingId||('room_'+num+'_'+today)).replace(/[.#$\[\]\/]/g,'_')+'_'+stg;
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);fbDelete('app/sentChecks/'+num+'_'+today);}
    else if(fbGet('app/sentChecks/'+num+'_'+today))return ContentService.createTextOutput(num+'호: 이미 발송됨 (재발송 버튼 사용)');
    try{
      const subject=ov.subject||('Check-in Info / 체크인 안내 — Room '+num);
      if(ov.bodyKo && String(ov.bodyKo).trim())sendMail(cb.guestEmail,subject,ov.bodyKo);
      if(ov.bodyEn && String(ov.bodyEn).trim())sendMail(cb.guestEmail,subject,ov.bodyEn);
      fbSet('app/mailLogs/'+logKey,{stage:stg,time:todayKST()+' '+nowHM(),email:cb.guestEmail,guest:cb.guest,room:num,edited:true});
      fbSet('app/sentChecks/'+num+'_'+today,today);
      fbDelete('app/sendOverrides/'+num+'_'+today);
      return ContentService.createTextOutput('✅ '+num+'호 '+cb.guest+'님께 발송 완료 (편집본)');
    }catch(err){
      GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 편집발송 실패: '+cb.guest,String(err));
      return ContentService.createTextOutput(num+'호: 발송 실패');
    }
  }
  if(p.action==='previewStage'&&p.stage){
    // [패치 2026-07-14] custom_* 단계 허용 — 발송탭 [안내] 커스텀 템플릿 미리보기
    const ALLOW=['s2_reminder','s4_checkout','s5_checkoutConfirm','s6_review'];
    const isCustom=String(p.stage).indexOf('custom_')===0;
    if(!isCustom&&ALLOW.indexOf(p.stage)<0)return jsonOut({ok:false,msg:'지원하지 않는 단계예요'});
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),source:cb.source||'',
        guest:cb.guest,guestEmail:cb.guestEmail,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    }
    if(!bk)return jsonOut({ok:false,msg:'예약을 찾지 못했어요'});
    if(!bk.guestEmail)return jsonOut({ok:false,msg:'손님 이메일이 없어요'});
    const nights=(bk.checkinDate&&bk.checkoutDate)?Math.round((new Date(bk.checkoutDate)-new Date(bk.checkinDate))/86400000):null;
    if(p.stage==='s4_checkout'&&nights===1)return jsonOut({ok:false,msg:'1박 예약은 퇴실안내가 입실안내에 포함돼요'});
    const r2=room?(fbGet('app/rooms/'+room)||{}):{};
    const tpl=fbGet('app/mailTemplates/'+p.stage)||{};
    if(isCustom&&!tpl.subject&&!tpl.bodyKo&&!tpl.bodyEn)return jsonOut({ok:false,msg:'템플릿이 없어요 — [템플릿 관리]에서 만들어주세요'});
    const fill=s=>String(s||'')
      .replace(/{guest}/g,bk.guest||'Guest').replace(/{checkinDate}/g,bk.checkinDate||'')
      .replace(/{checkoutDate}/g,bk.checkoutDate||'').replace(/{room}/g,room||'')
      .replace(/{floor}/g,room?floorOf(room):'').replace(/{doorPw}/g,r2.doorPw||'')
      .replace(/{reviewGuide}/g,reviewGuideFor(bk.source));
    const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_'+p.stage;
    return jsonOut({
      ok:true,stage:p.stage,guest:bk.guest,bid:p.bid||'',room:room||'',
      alreadySent:!!fbGet('app/mailLogs/'+logKey),
      subject:fill(tpl.subject||''),
      bodyKo:fill(tpl.bodyKo||(tpl.bodyEn?'':tpl.body||'')),
      bodyEn:fill(tpl.bodyEn||'')
    });
  }
  if(p.action==='sendStageEdited'&&p.stage){
    // [패치 2026-07-14] custom_* 단계 허용 — 발송탭 [안내] 커스텀 템플릿 발송(편집본)
    const ALLOW=['s2_reminder','s4_checkout','s5_checkoutConfirm','s6_review'];
    const isCustom=String(p.stage).indexOf('custom_')===0;
    if(!isCustom&&ALLOW.indexOf(p.stage)<0)return ContentService.createTextOutput('지원하지 않는 단계예요');
    const ovKey='stage_'+(p.bid||p.room||'x')+'_'+p.stage;
    const ov=fbGet('app/sendOverrides/'+ovKey);
    if(!ov||(!ov.bodyKo&&!ov.bodyEn))return ContentService.createTextOutput('편집 내용이 없어요');
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),source:cb.source||'',
        guest:cb.guest,guestEmail:cb.guestEmail,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    }
    if(!bk)return ContentService.createTextOutput('예약을 찾지 못했어요');
    if(!bk.guestEmail)return ContentService.createTextOutput('손님 이메일이 없어요');
    const logKey=String(bk.bookingId).replace(/[.#$\[\]\/]/g,'_')+'_'+p.stage;
    if(p.force==='1'){fbDelete('app/mailLogs/'+logKey);}
    else if(fbGet('app/mailLogs/'+logKey))return ContentService.createTextOutput('이미 발송됨 (재발송 버튼 사용)');
    try{
      const NAME={s2_reminder:'체크인 리마인더',s4_checkout:'퇴실 안내',s5_checkoutConfirm:'방문 고지',s6_review:'후기'};
      let label=NAME[p.stage];
      if(!label&&isCustom){const ct=fbGet('app/mailTemplates/'+p.stage)||{};label=ct.name||'안내';}
      const subject=ov.subject||((label||'안내')+' — Paradise Walk Residence');
      if(ov.bodyKo && String(ov.bodyKo).trim())sendMail(bk.guestEmail,subject,ov.bodyKo);
      if(ov.bodyEn && String(ov.bodyEn).trim())sendMail(bk.guestEmail,subject,ov.bodyEn);
      fbSet('app/mailLogs/'+logKey,{stage:p.stage,time:todayKST()+' '+nowHM(),email:bk.guestEmail,guest:bk.guest,room:room||'',edited:true});
      fbDelete('app/sendOverrides/'+ovKey);
      return ContentService.createTextOutput('✅ '+bk.guest+'님께 ['+(label||p.stage)+'] 발송 완료 (편집본)');
    }catch(err){
      GmailApp.sendEmail(ADMIN_EMAIL,'[PW] 편집발송 실패('+p.stage+'): '+bk.guest,String(err));
      return ContentService.createTextOutput('발송 실패');
    }
  }
  if(p.action==='sendStage'&&p.stage){
    const ALLOW=['s2_reminder','s4_checkout','s5_checkoutConfirm','s6_review'];
    if(ALLOW.indexOf(p.stage)<0)return ContentService.createTextOutput('지원하지 않는 단계예요');
    const NAME={s2_reminder:'체크인 리마인더',s4_checkout:'퇴실 안내',s5_checkoutConfirm:'방문 고지',s6_review:'후기'};
    let bk=null,room=p.room||null;
    if(p.bid){
      const pb=fbGet('app/pendingBookings/sv_'+p.bid)||fbGet('app/pendingBookings/'+p.bid);
      if(pb&&!pb.cancelled){bk=pb;if(!room&&pb.assignedRoom&&pb.assignedRoom!=='manual')room=pb.assignedRoom;}
    }
    if(!bk&&room){
      const r=fbGet('app/rooms/'+room);const cb=r&&r.currentBooking;
      if(cb&&cb.guest)bk={bookingId:cb.bookingId||('room_'+room+'_'+todayKST()),source:cb.source||'',
        guest:cb.guest,guestEmail:cb.guestEmail,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate};
    }
    if(!bk)return ContentService.createTextOutput('예약을 찾지 못했어요');
    if(!bk.guestEmail)return ContentService.createTextOutput('손님 이메일이 없어요');
    const ok=sendStageMail(p.stage,bk,room,true);
    return ContentService.createTextOutput(ok?('✅ '+bk.guest+'님께 ['+NAME[p.stage]+'] 발송 완료'):'발송 안 됨 — 이미 발송됐거나 템플릿 오류');
  }
  return ContentService.createTextOutput('Paradise Walk GAS 작동 중');
}

// ============================================================
// 자동 전환
// ============================================================
function t1100_checkoutConfirm(){
  const rooms=fbGet('app/rooms')||{},today=todayKST();
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    const cb=r.currentBooking;
    if(cb&&cb.checkoutDate===today&&r.status==='checkin')fbUpdate('app/rooms/'+num,{status:'checkout_confirm'});
  }
}
function t1159_moveBookings(){
  const today=todayKST();
  const hist=fbGet('app/bookingHistory')||{},cutoff=kstDate(-7);
  for(const [key,h] of Object.entries(hist)){if(!h.checkoutDate||h.checkoutDate<cutoff)fbDelete('app/bookingHistory/'+key);}
  const pend=fbGet('app/pendingBookings')||{},pCutoff=kstDate(-3);
  for(const [key,bk] of Object.entries(pend)){if(bk&&bk.checkoutDate&&bk.checkoutDate<pCutoff)fbDelete('app/pendingBookings/'+key);}
  for(const num of roomNums()){
    let r=fbGet('app/rooms/'+num);
    if(!r||r.blocked)continue;
    let guard=0;
    while(r.currentBooking&&r.currentBooking.guest&&r.currentBooking.checkoutDate&&r.currentBooking.checkoutDate<=today&&guard<10){
      guard++;
      const cb=r.currentBooking;
      const nextArr=(Array.isArray(r.nextBookings)?r.nextBookings:Object.values(r.nextBookings||{})).filter(b=>b);
      fbSet('app/bookingHistory/h_'+Date.now()+'_'+num+'_'+guard,{room:num,guest:cb.guest,checkinDate:cb.checkinDate,checkoutDate:cb.checkoutDate,source:cb.source||'',completedAt:today+' auto'});
      if(nextArr.length>0&&nextArr[0].checkinDate&&nextArr[0].checkinDate<=today){
        r={...r,currentBooking:nextArr[0],nextBookings:nextArr.slice(1)};
        fbUpdate('app/rooms/'+num,{currentBooking:nextArr[0],nextBookings:nextArr.slice(1),status:'need_clean'});
      }else{
        r={...r,currentBooking:null};
        fbUpdate('app/rooms/'+num,{currentBooking:null,nextBookings:nextArr,status:'need_clean'});
      }
    }
  }
}
function t1200_statusFix(){
  const rooms=fbGet('app/rooms')||{};
  for(const num of Object.keys(rooms)){
    const r=rooms[num];if(!r||r.blocked)continue;
    if(['checkout_confirm','checkout_done'].includes(r.status)&&(!r.currentBooking||!r.currentBooking.guest))fbUpdate('app/rooms/'+num,{status:'need_clean'});
  }
}

// ============================================================
// 운영 스위치
// ============================================================
function pauseAllMails(){
  fbSet('app/mailConfig/stages',{s1_confirm:false,s2_reminder:false,s3_checkin:false,s4_checkout:false,s5_checkoutConfirm:false,s6_review:false});
  Logger.log('전체 메일 OFF');
}
function resumeAllMails(){
  fbSet('app/mailConfig/stages',{s1_confirm:false,s2_reminder:true,s3_checkin:true,s4_checkout:true,s5_checkoutConfirm:false,s6_review:false});
  Logger.log('메일 재개 (2·3·4 자동 ON / 5·6 수동 운영)');
}

// ============================================================
// 트리거 설치
// ============================================================
function setupTriggers(){
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAllEtaToRooms').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('masterTick').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('t1100_checkoutConfirm').timeBased().atHour(11).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('t1159_moveBookings').timeBased().atHour(11).nearMinute(45).everyDays(1).create();
  ScriptApp.newTrigger('t1200_statusFix').timeBased().atHour(12).nearMinute(15).everyDays(1).create();
  ScriptApp.newTrigger('autoCheckinTick').timeBased().everyHours(1).create();
  Logger.log('트리거 6개 설치 완료');
}
function setBcc(){fbSet('app/config/bccEmail','joi.hurricane@gmail.com');Logger.log('BCC 켜짐');}
function clearBcc(){fbDelete('app/config/bccEmail');Logger.log('BCC 꺼짐');}

// ============================================================
// 자동 입실중 전환 — 21:00 이후 매시간
// ============================================================
function autoCheckinTick(){
  const min=nowMinKST();
  if(min<1260)return;
  const rooms=fbGet('app/rooms')||{};
  const sent=fbGet('app/sentChecks')||{};
  const today=todayKST();
  for(const num of Object.keys(rooms)){
    const r=rooms[num];
    if(!r||r.blocked)continue;
    const cb=r.currentBooking;
    if(!cb||!cb.guest)continue;
    if(cb.checkinDate!==today)continue;
    if(!sent[num+'_'+today])continue;
    if(r.status==='checkin')continue;
    if(r.status==='clean_done'){fbUpdate('app/rooms/'+num,{status:'checkin'});}
  }
}

// ============================================================
// 금액 동기화 — SIRVOY 알림메일에서 Total 추출해 pendingBookings에 저장
// ============================================================
function parseSirvoyAmount_(bookingId){
  var baseId = String(bookingId).split('_')[0].trim();
  if(!baseId) return null;
  // sirvoy booking alert 라벨에서 우선 검색 (inbox 비워져도 라벨로 찾음)
  var q = 'label:"sirvoy booking alert" from:support@sirvoy.com subject:("Booking ' + baseId + ' Added to Sirvoy")';
  var threads = GmailApp.search(q, 0, 5);
  // 라벨에서 못 찾으면 라벨 없이 한 번 더 (안전망)
  if(!threads || threads.length===0){
    q = 'from:support@sirvoy.com subject:("Booking ' + baseId + ' Added to Sirvoy")';
    threads = GmailApp.search(q, 0, 5);
  }
  for(var t=0;t<threads.length;t++){
    var msgs = threads[t].getMessages();
    for(var m=0;m<msgs.length;m++){
      var subj = msgs[m].getSubject() || '';
      if(subj.indexOf('Booking ' + baseId + ' ') < 0) continue;
      if(subj.indexOf('Added to Sirvoy') < 0) continue;   // 취소메일 제외
      var body = msgs[m].getBody() || '';
      var mt = body.match(/Total<\/strong>\s*:\s*([\d.]+,\d{2})/i);
      if(!mt) mt = body.match(/Total\s*:\s*([\d.]+,\d{2})/i);
      if(mt && mt[1]){
        var num = mt[1].replace(/\./g,'').split(',')[0];
        var won = parseInt(num,10);
        if(!isNaN(won)) return won;
      }
    }
  }
  return null;
}

function syncAmounts(){
  var pend = fbGet('app/pendingBookings') || {};
  var done = 0, tried = 0, notfound = 0;
  for(var key in pend){
    var bk = pend[key];
    if(!bk || bk.cancelled) continue;
    if(bk.amount !== undefined && bk.amount !== null && bk.amount !== '') continue;
    tried++;
    if(tried > 60) break;   // 한 틱 최대 60건
    var won = parseSirvoyAmount_(bk.bookingId || key);
    if(won !== null){
      fbUpdate('app/pendingBookings/' + key, { amount: won });
      done++;
    } else {
      notfound++;
    }
  }
  return '시도 ' + tried + '건, 채움 ' + done + '건, 메일못찾음 ' + notfound + '건';
}
